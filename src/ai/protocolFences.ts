import { maskWorkflowProposals } from "./workflowProposals";

export type ProtocolFence = { start: number; end: number; payload: string; closed: boolean };

/** An execution boundary, not a permissive Markdown renderer. Only a column-0
 * protocol header can request work. Indented/list/quoted/inline fences are
 * examples, and every enclosing fence (not just protocol fences) is tracked.
 * Inspect the original text for nesting; the workflow mask is an additional
 * veto, never a source of executable content. Offsets are UTF-16 throughout. */
export function executableProtocolFences(text: string, protocol: "husk-action" | "husk-edit"): ProtocolFence[] {
  const blocks: ProtocolFence[] = [];
  const masked = maskWorkflowProposals(text);
  let fence: { marker: string; length: number; start: number; payloadStart: number; executable: boolean } | null = null;
  let htmlEnd: RegExp | null = null;
  let inlineTicks: number | null = null;
  let start = 0;
  while (start < text.length) {
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, "");
    const wasInFence = fence !== null;
    const run = /`{3,}|~{3,}/.exec(line);
    if (run && !htmlEnd && inlineTicks === null) {
      const marker = run[0][0];
      const length = run[0].length;
      const prefix = line.slice(0, run.index);
      const info = line.slice(run.index + length).trim();
      if (fence) {
        const closingPrefix = fence.executable ? /^ {0,3}$/ : /^[\t >]*(?:(?:[-+*]|\d+[.)])[ \t]+)?[ \t]*$/;
        if (marker === fence.marker && length >= fence.length && !info && closingPrefix.test(prefix)) {
          if (fence.executable && masked.slice(fence.start, end) === text.slice(fence.start, end)) {
            blocks.push({ start: fence.start, end, payload: text.slice(fence.payloadStart, start), closed: true });
          }
          fence = null;
        }
      } else {
        const canonical = /^ {0,3}$/.test(prefix) && (marker !== "`" || !info.includes("`"));
        // Consume noncanonical example fences as inert regions as well. This
        // prevents their closing marker from swallowing a later real request.
        const example = /^[\t >]*(?:(?:[-+*]|\d+[.)])[ \t]+)?[ \t]*$/.test(prefix)
          && (marker !== "`" || !info.includes("`"));
        if (canonical || example) {
          fence = { marker, length, start, payloadStart: newline < 0 ? end : end + 1,
            executable: prefix === "" && info.toLowerCase() === protocol };
        }
      }
    }
    if (!fence && !wasInFence) {
      // Inline code can span physical lines and contain apparent protocol
      // fences. Match its exact delimiter length; backslashes are literal
      // inside a code span. Raw HTML comments/code regions are likewise inert,
      // including when they begin after prose. Scan in order so quoted HTML
      // inside a code span does not open an HTML region.
      const tokens = /`+|<!--|<(pre|code|script|style|textarea)(?:\s|>)/gi;
      let position = 0;
      while (position < line.length) {
        if (htmlEnd) {
          const close = htmlEnd.exec(line.slice(position));
          if (!close) break;
          position += close.index + close[0].length;
          htmlEnd = null;
          continue;
        }
        tokens.lastIndex = position;
        const token = tokens.exec(line);
        if (!token) break;
        position = tokens.lastIndex;
        if (inlineTicks !== null) {
          if (token[0][0] === "`" && token[0].length === inlineTicks) inlineTicks = null;
        } else if (token[0][0] === "`") {
          let escapes = 0;
          for (let i = token.index - 1; i >= 0 && line[i] === "\\"; i--) escapes++;
          if (escapes % 2 === 0) inlineTicks = token[0].length;
        } else {
          htmlEnd = token[1] ? new RegExp(`</${token[1]}\\s*>`, "i") : /-->/;
        }
      }
    }
    if (newline < 0) break;
    start = end + 1;
  }
  if (fence?.executable && masked.slice(fence.start) === text.slice(fence.start)) {
    blocks.push({ start: fence.start, end: text.length, payload: text.slice(fence.payloadStart), closed: false });
  }
  return blocks;
}
