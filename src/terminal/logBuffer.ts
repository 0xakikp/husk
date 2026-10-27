export type LogLevel = "info" | "warn" | "error" | "output";
export type LogEntry = { id: number; at: number; level: LogLevel; text: string };

// This is a readable preview, not an archive. The real terminal keeps its own
// scrollback. Bound unfinished lines as well as rows, including UTF-8 bytes.
export const LOG_LIMITS = { lines: 2000, lineChars: 4096, lineBytes: 8192, bytes: 256 * 1024 } as const;
export const LOG_BATCH_MS = 80;
const TRUNCATED = " … [line truncated]";
const encoder = new TextEncoder();
const TRUNCATED_BYTES = encoder.encode(TRUNCATED).byteLength;
type EscapeState = "text" | "escape" | "csi" | "osc" | "osc-escape" | "charset";

function levelFor(text: string): LogLevel {
  if (/\b(?:fatal|error|exception|panic|failed|failure)\b/i.test(text)) return "error";
  if (/\b(?:warn|warning|deprecated)\b/i.test(text)) return "warn";
  if (/\b(?:info|ready|started|listening|compiled|success|connected)\b/i.test(text)) return "info";
  return "output";
}

/** Streaming ANSI removal never stores control-sequence payloads. In
 * particular, an unfinished OSC or printable line cannot grow indefinitely. */
export class TerminalLogBuffer {
  private rows: Array<{ entry: LogEntry; bytes: number }> = [];
  private bytes = 0;
  private pending = "";
  private pendingBytes = 0;
  private truncated = false;
  private escape: EscapeState = "text";
  private afterCR = false;
  private nextId: number;
  private revision = 0;
  private limited = false;

  constructor(startId = 1) { this.nextId = startId; }

  get version() { return this.revision; }
  get nextLineId() { return this.nextId; }
  get isLimited() { return this.limited; }
  get retainedBytes() { return this.bytes + this.pendingBytes; }
  get pendingChars() { return this.pending.length; }
  snapshot(): LogEntry[] { return this.rows.map(({ entry }) => entry); }

  private finishLine(at: number) {
    const id = this.nextId++;
    const text = this.pending.trimEnd() + (this.truncated ? TRUNCATED : "");
    this.pending = "";
    this.pendingBytes = 0;
    this.truncated = false;
    if (!text.trim()) return;
    const bytes = encoder.encode(text).byteLength;
    this.rows.push({ entry: { id, at, text, level: levelFor(text) }, bytes });
    this.bytes += bytes;
    while (this.rows.length > LOG_LIMITS.lines || this.bytes > LOG_LIMITS.bytes) {
      this.bytes -= this.rows.shift()!.bytes;
      this.limited = true;
    }
    this.revision++;
  }

  /** Finish a static snapshot, but never turn a partial live line into a row. */
  finishSnapshot(at = Date.now()) { this.finishLine(at); }

  /** Pausing must not stitch pre-pause and post-pause fragments together. */
  discardPartial() {
    this.pending = "";
    this.pendingBytes = 0;
    this.truncated = false;
    this.escape = "text";
    this.afterCR = false;
  }

  append(raw: string, at = Date.now()) {
    for (const char of raw) {
      if (this.escape === "osc") {
        if (char === "\x07") this.escape = "text";
        else if (char === "\x1b") this.escape = "osc-escape";
        continue;
      }
      if (this.escape === "osc-escape") {
        this.escape = char === "\\" || char === "\x07" ? "text" : char === "\x1b" ? "osc-escape" : "osc";
        continue;
      }
      if (this.escape === "csi") {
        if (char >= "@" && char <= "~") this.escape = "text";
        else if (char === "\x1b") this.escape = "escape";
        continue;
      }
      if (this.escape === "charset") { this.escape = "text"; continue; }
      if (this.escape === "escape") {
        this.escape = char === "]" ? "osc" : char === "[" ? "csi" : char === "(" || char === ")" ? "charset" : "text";
        continue;
      }
      if (char === "\x1b") { this.escape = "escape"; continue; }
      if (char === "\n" && this.afterCR) { this.afterCR = false; continue; }
      this.afterCR = char === "\r";
      if (char === "\n" || char === "\r") { this.finishLine(at); continue; }
      const point = char.codePointAt(0)!;
      if ((point < 32 && char !== "\t") || (point >= 127 && point <= 159)) continue;
      if (this.truncated) continue;
      const bytes = point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4;
      // Leave room for the visible truncation marker inside both line limits.
      if (this.pending.length + char.length > LOG_LIMITS.lineChars - TRUNCATED.length
        || this.pendingBytes + bytes > LOG_LIMITS.lineBytes - TRUNCATED_BYTES) {
        this.truncated = true;
        if (!this.limited) { this.limited = true; this.revision++; }
        continue;
      }
      this.pending += char;
      this.pendingBytes += bytes;
    }
  }
}
