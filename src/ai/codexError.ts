import { scanForSecrets } from "./contextItems";

const MAX_INPUT_CHARS = 16 * 1024;
const MAX_MESSAGE_CHARS = 420;
const MAX_DEPTH = 8;
const FALLBACK = "Codex could not complete this request. Check your Codex sign-in and selected model, then try again.";
const UNSUPPORTED_MODEL = "This model is not supported by your signed-in Codex account. Choose Codex default in Settings → AI & Models, then try again.";

function unsupportedModel(text: string): boolean {
  return /\b(?:unsupported[_ -]model|model[_ -]not[_ -]supported)\b/i.test(text)
    || /\bmodel\b[^\n]{0,160}\b(?:not supported|unsupported|not available|unavailable|does not exist)\b/i.test(text)
    || /\b(?:unsupported|unavailable)\b[^\n]{0,60}\bmodel\b/i.test(text);
}

function removeTerminalEscapes(text: string): string {
  return text
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "");
}

/** Error envelopes may be objects, nested JSON strings, or stderr prefixed
 * with "Error:". Walk only known error fields; never stringify unknown data. */
export function formatCodexError(error: unknown): string {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: error, depth: 0 }];
  const seen = new Set<object>();
  const messages: Array<{ text: string; depth: number }> = [];
  let inspected = 0;
  while (pending.length && inspected++ < 24) {
    const { value, depth } = pending.shift()!;
    if (depth > MAX_DEPTH || value == null) continue;
    if (typeof value === "string") {
      const bounded = removeTerminalEscapes(value.slice(0, MAX_INPUT_CHARS)).trim();
      if (unsupportedModel(bounded)) return UNSUPPORTED_MODEL;
      if (value.length > MAX_INPUT_CHARS || !bounded) continue;
      const text = bounded.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
      const opening = text.search(/[\[{]/);
      const json = text.startsWith('"') ? text : opening >= 0 ? text.slice(opening) : text;
      try {
        const parsed: unknown = JSON.parse(json);
        pending.push({ value: parsed, depth: depth + 1 });
      } catch {
        // A partial/malformed JSON envelope is not a user-facing message.
        if (!/[\[{]\s*(?:"|\{|\[)|^\s*[\[{]/.test(text)) messages.push({ text, depth });
      }
      continue;
    }
    if (typeof value !== "object" || Array.isArray(value) || seen.has(value)) continue;
    seen.add(value);
    try {
      const object = value as Record<string, unknown>;
      for (const key of ["code", "type"]) {
        if (typeof object[key] === "string" && unsupportedModel(object[key].slice(0, 200))) return UNSUPPORTED_MODEL;
      }
      for (const key of ["error", "message", "cause", "detail"]) {
        if (object[key] !== undefined) pending.push({ value: object[key], depth: depth + 1 });
      }
    } catch { /* Malformed/native objects cannot make error reporting throw. */ }
  }
  messages.sort((a, b) => b.depth - a.depth);
  for (const candidate of messages) {
    // Some stderr writers escape text without wrapping it in a JSON string.
    // Decode bounded character escapes before checking for concealed secrets.
    const text = removeTerminalEscapes(candidate.text.replace(/\\u([0-9a-f]{4})|\\x([0-9a-f]{2})/gi,
      (_match, unicode: string | undefined, byte: string | undefined) => String.fromCharCode(Number.parseInt(unicode ?? byte!, 16))));
    if (scanForSecrets("Codex error", text).length
      || /\b(?:authorization|api[_-]?key|secret|token|password|passwd|credentials?)\b\s*[:=]\s*\S+/i.test(text)
      || /\b(?:https?|wss?):\/\/[^\s/]*@/i.test(text)) return FALLBACK;
    // URLs can carry query-string credentials and are unnecessary for a
    // compact error; model/account settings remain available in the UI.
    const cleaned = text.replace(/\b(?:https?|wss?):\/\/\S+/gi, "[endpoint]").replace(/\\(?:n|r|t)/g, " ").replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const readable = /^codex\b/i.test(cleaned) ? cleaned : `Codex: ${cleaned.replace(/^error:\s*/i, "")}`;
    return readable.length > MAX_MESSAGE_CHARS ? `${readable.slice(0, MAX_MESSAGE_CHARS - 1)}…` : readable;
  }
  return FALLBACK;
}
