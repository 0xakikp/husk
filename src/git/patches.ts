import { invoke } from "@tauri-apps/api/core";
import { literalGitPaths, runGit, runGitOutput, type GitFile } from "./client";

export type DiffLine = { text: string; kind: "context" | "addition" | "deletion" | "meta" | "hunk"; oldLine?: number; newLine?: number; hunkIndex?: number };
export type DiffHunk = { header: string; start: number; end: number; oldStart: number; oldCount: number; newStart: number; newCount: number };
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/;
const MAX_PATCH_BYTES = 240 * 1024;

/** Display parsing is deliberately permissive: binary/combined/unsupported
 * patches remain readable but never become a stageable patch. */
export function diffLines(text: string): DiffLine[] {
  const rows = text.split("\n");
  if (rows[rows.length - 1] === "") rows.pop();
  let oldLine = 0, newLine = 0, remainingOld = 0, remainingNew = 0, hunkIndex = -1;
  return rows.map((line) => {
    const match = HUNK.exec(line);
    if (match) {
      oldLine = Number(match[1]); newLine = Number(match[3]);
      remainingOld = Number(match[2] ?? 1); remainingNew = Number(match[4] ?? 1);
      return { text: line, kind: "hunk", hunkIndex: ++hunkIndex };
    }
    if (remainingOld > 0 || remainingNew > 0) {
      if (line.startsWith(" ") && remainingOld > 0 && remainingNew > 0) { remainingOld--; remainingNew--; return { text: line, kind: "context", oldLine: oldLine++, newLine: newLine++ }; }
      if (line.startsWith("-") && remainingOld > 0) { remainingOld--; return { text: line, kind: "deletion", oldLine: oldLine++ }; }
      if (line.startsWith("+") && remainingNew > 0) { remainingNew--; return { text: line, kind: "addition", newLine: newLine++ }; }
    }
    return { text: line, kind: "meta" };
  });
}

/** Restrict hunk staging to an ordinary single-file text modification. The
 * native command repeats all validation and derives the selected patch itself. */
export function stageableHunks(text: string): DiffHunk[] {
  if (!text.endsWith("\n") || text.includes("\0") || text.includes("\uFFFD") || new TextEncoder().encode(text).length > MAX_PATCH_BYTES) return [];
  const lines = text.slice(0, -1).split("\n");
  if (!lines[0]?.startsWith("diff --git a/") || !/^index [0-9a-f]+\.\.[0-9a-f]+ 100(?:644|755)$/.test(lines[1] ?? "") || !lines[2]?.startsWith("--- a/") || !lines[3]?.startsWith("+++ b/") || lines[2].slice(6) !== lines[3].slice(6)) return [];
  const hunks: DiffHunk[] = [];
  let i = 4;
  while (i < lines.length) {
    const match = HUNK.exec(lines[i]!);
    if (!match) return [];
    const start = i++, oldStart = Number(match[1]), newStart = Number(match[3]);
    const oldCount = Number(match[2] ?? 1), newCount = Number(match[4] ?? 1);
    if (![oldStart, newStart, oldCount, newCount].every(Number.isSafeInteger)) return [];
    let oldSeen = 0, newSeen = 0, changed = false;
    while (i < lines.length && !lines[i]!.startsWith("@@ ")) {
      const line = lines[i++]!;
      if (line.startsWith(" ")) { oldSeen++; newSeen++; }
      else if (line.startsWith("-")) { oldSeen++; changed = true; }
      else if (line.startsWith("+")) { newSeen++; changed = true; }
      else if (line !== "\\ No newline at end of file") return [];
    }
    if (!changed || oldSeen !== oldCount || newSeen !== newCount) return [];
    hunks.push({ header: lines[start]!, start, end: i, oldStart, oldCount, newStart, newCount });
  }
  return hunks;
}

export function canStageDiffHunks(file: GitFile, text: string): boolean {
  return !file.conflicted && !file.originalPath && (file.index === " " || file.index === "M") && file.work === "M" && stageableHunks(text).length > 0;
}

export async function stageDiffHunk(file: GitFile, reviewedDiff: string, hunkIndex: number, cwd: string): Promise<void> {
  literalGitPaths([file.path]);
  const hunks = stageableHunks(reviewedDiff);
  if (!cwd || !canStageDiffHunks(file, reviewedDiff) || !Number.isInteger(hunkIndex) || hunkIndex < 0 || hunkIndex >= hunks.length) throw new Error("Only complete text hunks from an unchanged tracked file can be staged here. Refresh the diff or stage the whole file.");
  try { await invoke("git_stage_diff_hunk", { cwd, path: file.path, reviewedDiff, hunkIndex }); }
  catch (cause) {
    // Tauri serializes Rust Result errors as strings, not JavaScript Errors.
    // Preserve stale-review/lock guidance instead of losing it to a generic toast.
    throw cause instanceof Error ? cause : new Error(typeof cause === "string" ? cause : "Could not stage this hunk. Refresh and review the diff.");
  }
}

export async function commitDiff(hash: string, cwd: string): Promise<string> {
  // Never accept an option, revision expression or symbolic ref from a row.
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash)) throw new Error("Select a valid commit first.");
  return runGit(["show", "--format=fuller", "--no-ext-diff", "--no-textconv", "--no-color", "--first-parent", "--patch", "--stat", hash, "--"], cwd, { allowTruncated: true });
}

export type ConflictVersions = { base: string | null; ours: string | null; theirs: string | null };

export async function readConflictVersions(path: string, cwd: string): Promise<ConflictVersions> {
  literalGitPaths([path]);
  // Resolve the exact unmerged index entries first, then read immutable blob
  // objects. An absent side (add/delete conflict) is different from an error.
  const entries = await runGit(["ls-files", "--unmerged", "-z", "--", path], cwd);
  if (!entries) throw new Error("This file no longer has unmerged index entries. Refresh Git status.");
  const stages = new Map<number, string>();
  for (const entry of entries.split("\0").filter(Boolean)) {
    const match = /^(100644|100755) ([0-9a-f]{40}|[0-9a-f]{64}) ([123])\t([\s\S]+)$/.exec(entry);
    if (!match || match[4] !== path) throw new Error("This conflict contains a symlink, submodule, or unsupported index entry. Review it in the terminal.");
    stages.set(Number(match[3]), match[2]!);
  }
  const read = async (stage: number) => {
    const oid = stages.get(stage);
    if (!oid) return null;
    const size = await runGit(["cat-file", "-s", oid], cwd);
    if (!/^\d+\s*$/.test(size) || Number(size) > MAX_PATCH_BYTES) throw new Error("This conflict is too large for the preview. Open the file in the editor.");
    const result = await runGitOutput(["cat-file", "blob", oid], cwd);
    if (result.stdout.includes("\0") || result.stdout.includes("\uFFFD")) throw new Error("Binary or non-UTF-8 conflict content cannot be shown as editable text.");
    return result.stdout;
  };
  const [base, ours, theirs] = await Promise.all([read(1), read(2), read(3)]);
  return { base, ours, theirs };
}
