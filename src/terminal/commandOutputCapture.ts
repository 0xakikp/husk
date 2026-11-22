export const MAX_COMMAND_OUTPUT_BYTES = 12 * 1024;
export const MAX_COMMAND_OUTPUT_LINES = 200;

/** A bounded, completed command run used by local terminal features. */
export type CapturedCommandRun = {
  leafId: number;
  ptyId: number;
  cwd: string;
  /** null denotes a local shell; an unknown SSH target must not be recorded. */
  remoteHost: string | null;
  command: string;
  output: string;
  exitCode: number | null;
  at: number;
  truncated?: boolean;
};

/** Dedicated provenance survives the registry's active-shell UI flag resetting
 * on OSC 133 D. Unknown or same-host SSH provenance fails closed. */
export class CommandOutputScopeTracker {
  private localHost: string | null = null;
  private cwdHost: string | null = null;
  private remoteEntered = false;
  private remoteConfirmed = false;
  private cwdUri: string | null = null;
  private generation = 0;

  observeCwd(uri: string, isRemote: boolean): boolean {
    if (this.cwdUri !== uri) this.generation++;
    this.cwdUri = uri;
    const host = /^file:\/\/([^/]+)\//.exec(uri)?.[1] ?? null;
    const changed = host !== this.cwdHost;
    this.cwdHost = host;
    if (!this.localHost && !isRemote && !this.remoteEntered) this.localHost = host;
    if (this.remoteEntered && this.localHost && host) {
      if (host !== this.localHost) this.remoteConfirmed = true;
      else if (this.remoteConfirmed) { this.remoteEntered = false; this.remoteConfirmed = false; }
    }
    return changed;
  }

  enterRemote(): void { this.generation++; this.remoteEntered = true; this.remoteConfirmed = false; }
  leaveRemote(): void { this.generation++; this.remoteEntered = false; this.remoteConfirmed = false; }
  getGeneration(): number { return this.generation; }

  /** undefined means there is not enough provenance to capture this run. */
  target(isRemote: boolean): string | null | undefined {
    if (!this.localHost || !this.cwdHost) return undefined;
    if (this.remoteEntered) return this.remoteConfirmed ? this.cwdHost : undefined;
    return !isRemote && this.cwdHost === this.localHost ? null : undefined;
  }
}

type OutputBuffer = {
  baseY: number;
  cursorY: number;
  cursorX: number;
  getLine(index: number): { isWrapped?: boolean; translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string } | undefined;
};

/** Use a tracked marker, not an absolute row that becomes stale on scrollback trim. */
export function captureCommandOutput(buffer: OutputBuffer, startLine: number | null): { output: string; truncated: boolean } {
  const cursorRow = buffer.baseY + buffer.cursorY;
  const end = cursorRow + (buffer.cursorX > 0 ? 1 : 0);
  const start = Math.max(startLine ?? 0, end - MAX_COMMAND_OUTPUT_LINES);
  const lines: string[] = [];
  let truncated = startLine == null || start > startLine;
  let characters = 0;
  for (let row = start; row < end; row++) {
    const line = buffer.getLine(row);
    if (!line) { truncated = true; continue; }
    const text = line.translateToString(true, 0, row === cursorRow ? buffer.cursorX : undefined);
    // Even an unexpectedly wide terminal cannot allocate an unbounded sample.
    if (characters + text.length > MAX_COMMAND_OUTPUT_BYTES) { truncated = true; break; }
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
    characters += text.length;
  }
  const bounded = boundCommandOutput(lines.join("\n"));
  return { output: bounded.output, truncated: truncated || bounded.truncated };
}

/** Retain a whole-line prefix with a strict UTF-8 budget. No hidden tail is retained. */
export function boundCommandOutput(output: string): { output: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const lines = output ? output.split("\n") : [];
  const retained: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const size = encoder.encode(line).byteLength + (retained.length ? 1 : 0);
    if (retained.length >= MAX_COMMAND_OUTPUT_LINES || bytes + size > MAX_COMMAND_OUTPUT_BYTES) {
      return { output: retained.join("\n"), truncated: true };
    }
    retained.push(line);
    bytes += size;
  }
  return { output: retained.join("\n"), truncated: false };
}
