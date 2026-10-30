import { bytes, object, validateWorkflow } from "../workflows/schema";

/** A local review proposal, not a tool call or an instruction to save/run. */
export type AiWorkflowProposal = {
  name: string;
  description?: string;
  steps: string[];
  stepTitles?: string[];
  stopOnError: true;
};

export type WorkflowProposalParseResult = {
  proposals: AiWorkflowProposal[];
  rejected: number;
  pending: boolean;
};

const MAX_PROPOSAL_BYTES = 128 * 1024;
const MAX_PROPOSALS = 3;
const ALLOWED_FIELDS = new Set(["version", "name", "description", "steps", "stepTitles", "stopOnError"]);
const SINGLE_LINE_CONTROLS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

type ProposalBlock = { start: number; end: number; payloadStart: number; payloadEnd: number; closed: boolean };

/** Respect surrounding Markdown fences. A protocol example inside a larger
 * code fence is data, not another proposal. Requiring own-line fences also
 * avoids promoting a prose mention or shell string into an interactive card.
 * Keep offsets instead of allocating an unbounded array of response lines. */
function proposalBlocks(text: string): ProposalBlock[] {
  const blocks: ProposalBlock[] = [];
  let fence: { marker: string; length: number; start: number; payloadStart: number; proposal: boolean } | null = null;
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, "");
    const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (match) {
      const marker = match[1][0];
      const length = match[1].length;
      const info = match[2].trim();
      if (fence) {
        if (marker === fence.marker && length >= fence.length && !info) {
          if (fence.proposal) blocks.push({ start: fence.start, end, payloadStart: fence.payloadStart, payloadEnd: start, closed: true });
          fence = null;
        }
      } else if (marker !== "`" || !info.includes("`")) {
        fence = { marker, length, start, payloadStart: newline < 0 ? end : end + 1, proposal: /^husk-workflow$/i.test(info) };
      }
    }
    if (newline < 0) break;
    start = end + 1;
  }
  if (fence?.proposal) blocks.push({ start: fence.start, end: text.length, payloadStart: fence.payloadStart, payloadEnd: text.length, closed: false });
  return blocks;
}

function validateProposal(payload: string): AiWorkflowProposal {
  if (payload.length > MAX_PROPOSAL_BYTES || bytes(payload) > MAX_PROPOSAL_BYTES) throw new Error("Workflow proposal exceeds 128 KiB.");
  const raw: unknown = JSON.parse(payload);
  if (!object(raw) || raw.version !== 1 || Object.keys(raw).some((key) => !ALLOWED_FIELDS.has(key))) throw new Error("Unsupported workflow proposal format.");
  if (raw.stopOnError !== undefined && raw.stopOnError !== true) throw new Error("Proposed workflows must stop on a failed step.");
  const workflow = validateWorkflow({ ...raw, id: "ai-review-proposal", stopOnError: true });
  if (workflow.steps.some((step) => SINGLE_LINE_CONTROLS.test(step))) throw new Error("Each proposed step must be one command line without control characters.");
  if (SINGLE_LINE_CONTROLS.test(workflow.name) || workflow.stepTitles?.some((title) => SINGLE_LINE_CONTROLS.test(title))) throw new Error("Workflow names and step titles must be single-line text.");
  if (workflow.description && /[\x7f-\x9f]/.test(workflow.description)) throw new Error("Workflow descriptions cannot contain control characters.");
  return {
    name: workflow.name,
    ...(workflow.description === undefined ? {} : { description: workflow.description }),
    steps: workflow.steps,
    ...(workflow.stepTitles === undefined ? {} : { stepTitles: workflow.stepTitles }),
    stopOnError: true,
  };
}

/** Parsing is inert. It never reads a saved workflow, chooses a destination,
 * writes a draft, or invokes a terminal. The user reviews every accepted card. */
export function parseWorkflowProposals(text: string): WorkflowProposalParseResult {
  const proposals: AiWorkflowProposal[] = [];
  let rejected = 0;
  let pending = false;
  for (const block of proposalBlocks(text)) {
    if (!block.closed) { pending = true; continue; }
    if (proposals.length >= MAX_PROPOSALS || block.payloadEnd - block.payloadStart > MAX_PROPOSAL_BYTES) { rejected += 1; continue; }
    try { proposals.push(validateProposal(text.slice(block.payloadStart, block.payloadEnd))); }
    catch { rejected += 1; }
  }
  return { proposals, rejected, pending };
}

/** Hide protocol JSON even when malformed or unfinished. The caller must show
 * the parser's rejected/pending state instead of silently dropping a proposal. */
export function stripWorkflowProposals(text: string): string {
  const blocks = proposalBlocks(text);
  if (!blocks.length) return text;
  let visible = "";
  let cursor = 0;
  for (const block of blocks) {
    visible += text.slice(cursor, block.start);
    cursor = block.end;
  }
  return (visible + text.slice(cursor)).replace(/\n{3,}/g, "\n\n").trim();
}

/** Executable-action parsers must not interpret protocol-looking strings
 * inside a workflow proposal. Preserve UTF-16 offsets and line breaks so they
 * can safely use matches against this mask to slice the original response.
 *
 * Unlike card rendering, this safety boundary also recognizes a workflow
 * header inside another fence, after prose, or with excessive indentation.
 * The legacy action protocol accepts inline openers, so standard Markdown
 * fence state alone cannot reliably identify later workflow boundaries.
 * Require the header to end its physical line, avoiding false positives from
 * escaped protocol strings inside valid action JSON. Conservatively mask
 * malformed workflow examples too; never promote their content into actions. */
export function maskWorkflowProposals(text: string): string {
  let masked = "";
  let cursor = 0;
  let start = 0;
  let fence: { marker: string; length: number; start: number } | null = null;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, "");
    if (fence) {
      const closing = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length && !closing[2].trim()) {
        masked += text.slice(cursor, fence.start);
        masked += text.slice(fence.start, end).replace(/[^\r\n]/g, " ");
        cursor = end;
        fence = null;
      }
    } else {
      // Find the fixed header first, then walk its marker run backwards. An
      // unanchored variable-length marker regex can backtrack quadratically
      // on a long line of backticks from an untrusted model response.
      const header = /husk-workflow[ \t]*$/i.exec(line);
      if (header) {
        let markerEnd = header.index;
        while (markerEnd > 0 && (line[markerEnd - 1] === " " || line[markerEnd - 1] === "\t")) markerEnd--;
        const marker = line[markerEnd - 1];
        if (marker === "`" || marker === "~") {
          let markerStart = markerEnd;
          while (markerStart > 0 && line[markerStart - 1] === marker) markerStart--;
          const length = markerEnd - markerStart;
          if (length >= 3) fence = { marker, length, start: start + markerStart };
        }
      }
    }
    if (newline < 0) break;
    start = end + 1;
  }
  if (fence) {
    masked += text.slice(cursor, fence.start);
    masked += text.slice(fence.start).replace(/[^\r\n]/g, " ");
    cursor = text.length;
  }
  return masked + text.slice(cursor);
}
