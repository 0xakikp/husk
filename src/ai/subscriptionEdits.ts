import { resolveWorkspacePath } from "./workspaceScope";

/** Legacy signed-in CLI edit interchange. New provider-neutral requests use
 * `husk-action`; this format remains for existing review and auto-apply
 * sessions. Husk validates every proposal before it can write. */
export type SubscriptionEditProposal =
  | { kind: "edit"; path: string; search: string; replace: string }
  | { kind: "create"; path: string; content: string };

export type SubscriptionEditParseResult = {
  proposals: SubscriptionEditProposal[];
  rejected: number;
};

const MAX_PROPOSALS = 12;
const MAX_FIELD_CHARS = 200_000;
const EDIT_FENCE = /```husk-edit\s*\n([\s\S]*?)```/gi;

function recordsFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { edits?: unknown[] }).edits)) {
    return (value as { edits: unknown[] }).edits;
  }
  return [value];
}

/** Parse only explicit `husk-edit` fences. Normal prose, Markdown diffs, and
 * malformed JSON are deliberately ignored rather than guessed into a write. */
export function parseSubscriptionEditProposals(
  response: string,
  workspaceRoot: string,
): SubscriptionEditParseResult {
  const proposals: SubscriptionEditProposal[] = [];
  let rejected = 0;
  let match: RegExpExecArray | null;

  while ((match = EDIT_FENCE.exec(response)) !== null) {
    let payload: unknown;
    try {
      payload = JSON.parse(match[1]);
    } catch {
      rejected += 1;
      continue;
    }

    for (const item of recordsFrom(payload)) {
      if (proposals.length >= MAX_PROPOSALS) {
        rejected += 1;
        continue;
      }
      if (!item || typeof item !== "object") {
        rejected += 1;
        continue;
      }
      const candidate = item as Record<string, unknown>;
      const path = typeof candidate.path === "string"
        ? resolveWorkspacePath(candidate.path, workspaceRoot)
        : null;
      if (!path) {
        rejected += 1;
        continue;
      }

      if (candidate.kind === "edit") {
        const { search, replace } = candidate;
        if (
          typeof search !== "string" ||
          search.length === 0 ||
          search.length > MAX_FIELD_CHARS ||
          typeof replace !== "string" ||
          replace.length > MAX_FIELD_CHARS
        ) {
          rejected += 1;
          continue;
        }
        proposals.push({ kind: "edit", path, search, replace });
      } else if (candidate.kind === "create") {
        const { content } = candidate;
        if (typeof content !== "string" || content.length > MAX_FIELD_CHARS) {
          rejected += 1;
          continue;
        }
        proposals.push({ kind: "create", path, content });
      } else {
        rejected += 1;
      }
    }
  }
  return { proposals, rejected };
}
