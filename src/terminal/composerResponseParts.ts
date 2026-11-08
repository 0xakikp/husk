/** A response is rendered in source order, never as prose followed by a second
 * collection of all code. `actionable` is only a prerequisite: callers must
 * still check streaming state, shell language, and command-run policy. */
export type ComposerResponsePart =
  | { kind: "text"; text: string }
  | { kind: "code"; lang: string; code: string; actionable: boolean }
  | { kind: "workflow"; text: string };

const MAX_PARTS = 512;
const PROTOCOL_LANGUAGE = /^husk-(?:workflow|action|edit)$/i;

type Fence = {
  marker: string;
  length: number;
  start: number;
  payloadStart: number;
  info: string;
  example: boolean;
  contaminated: boolean;
};

/** Recognize quoted/list/indented fences without a backtracking expression
 * over arbitrary model output. Such examples stay text, including delimiters. */
function examplePrefix(prefix: string): boolean {
  let i = 0;
  while (i < prefix.length && (prefix[i] === " " || prefix[i] === "\t" || prefix[i] === ">")) i++;
  if (i === prefix.length) return true;
  if (prefix[i] === "-" || prefix[i] === "+" || prefix[i] === "*") i++;
  else {
    const start = i;
    while (i < prefix.length && prefix[i] >= "0" && prefix[i] <= "9") i++;
    if (i === start || (prefix[i] !== "." && prefix[i] !== ")")) return false;
    i++;
  }
  const spaceStart = i;
  while (i < prefix.length && (prefix[i] === " " || prefix[i] === "\t")) i++;
  return i > spaceStart && i === prefix.length;
}

/** A protocol-looking fence inside ordinary code is data. Never remove part
 * of that code and then offer the altered remainder as an executable script.
 * Search the fixed header first, so a long backtick run is linear to inspect. */
function containsProtocolFence(line: string): boolean {
  const headers = /husk-(?:workflow|action|edit)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = headers.exec(line)) !== null) {
    let end = match.index;
    while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
    const marker = line[end - 1];
    if (marker !== "`" && marker !== "~") continue;
    let start = end;
    while (start > 0 && line[start - 1] === marker) start--;
    if (end - start >= 3) return true;
  }
  return false;
}

/** Offset-based Markdown fence scanner. No HTML is interpreted or emitted as
 * markup. Multiline inline-code and HTML examples suppress fence extraction;
 * callers render the returned text through their existing escaped renderer.
 * The bounded part count avoids thousands of interactive React cards while
 * preserving any remaining response as inert text rather than dropping it. */
export function parseComposerResponseParts(text: string): ComposerResponsePart[] {
  const parts: ComposerResponsePart[] = [];
  let fence: Fence | null = null;
  let cursor = 0;
  let start = 0;
  let inlineTicks: number | null = null;
  let htmlEnd: RegExp | null = null;

  const appendText = (value: string) => {
    if (value) parts.push({ kind: "text", text: value });
  };
  const appendFence = (block: Fence, end: number, payloadEnd: number, closed: boolean) => {
    appendText(text.slice(cursor, block.start));
    const source = text.slice(block.start, end);
    if (block.example) appendText(source);
    else if (/^husk-workflow$/i.test(block.info)) parts.push({ kind: "workflow", text: source });
    else {
      const lang = block.info.split(/[ \t]/, 1)[0].toLowerCase().slice(0, 64);
      // Remove only the structural line ending before the closing delimiter.
      // Leading indentation, blank lines, and partial streamed code stay intact.
      const payload = text.slice(block.payloadStart, payloadEnd);
      const code = closed ? payload.replace(/\r?\n$/, "") : payload;
      parts.push({ kind: "code", lang, code, actionable: closed && !block.contaminated && !PROTOCOL_LANGUAGE.test(lang) });
    }
    cursor = end;
  };

  while (start < text.length) {
    if (!fence && parts.length >= MAX_PARTS - 2) break;
    const newline = text.indexOf("\n", start);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(start, end).replace(/\r$/, "");
    const wasInFence = fence !== null;
    const run = /`{3,}|~{3,}/.exec(line);
    if (run && !htmlEnd && inlineTicks === null) {
      const prefix = line.slice(0, run.index);
      const marker = run[0][0];
      const length = run[0].length;
      const info = line.slice(run.index + length).trim();
      const canonical = /^ {0,3}$/.test(prefix);
      if (fence) {
        if (marker === fence.marker && length >= fence.length && !info && (canonical || (fence.example && examplePrefix(prefix)))) {
          appendFence(fence, end, start, true);
          fence = null;
        }
      } else if ((canonical || examplePrefix(prefix)) && (marker !== "`" || !info.includes("`"))) {
        fence = { marker, length, start, payloadStart: newline < 0 ? end : end + 1, info, example: !canonical, contaminated: false };
      }
    }
    if (fence && wasInFence && containsProtocolFence(line)) fence.contaminated = true;
    if (!fence && !wasInFence) {
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
  if (fence) appendFence(fence, text.length, text.length, false);
  appendText(text.slice(cursor));
  return parts;
}
