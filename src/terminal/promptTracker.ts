import type { IMarker, Terminal } from "@xterm/xterm";
import { absolutePromptPosition, inspectPromptReadiness, type PromptPosition } from "./promptDraft";

/** An OSC 133 B boundary belongs to a buffer line, not a fixed screen row.
 * xterm markers follow output reflow and scrollback trimming. They do not track
 * columns or shell input, so uncertain redraws still require a fresh B. */
export class TerminalPromptTracker {
  private marker: IMarker | undefined;
  private col = 0;
  private columns = 0;
  private prefix = "";

  constructor(private readonly term: Terminal) {}

  capture(): void {
    this.clear();
    const buffer = this.term.buffer.active;
    if (buffer.type !== "normal") return;
    const pos = absolutePromptPosition(buffer);
    if (pos.col >= this.term.cols) return;
    const line = buffer.getLine(pos.row);
    if (!line) return;
    this.marker = this.term.registerMarker(0);
    this.col = pos.col;
    this.columns = this.term.cols;
    this.prefix = line.translateToString(false, 0, pos.col);
  }

  position(): PromptPosition | null {
    const marker = this.marker;
    if (!marker) return null;
    if (marker.isDisposed || this.columns !== this.term.cols
      || !this.term.markers.includes(marker)) {
      this.clear();
      return null;
    }
    const buffer = this.term.buffer.active;
    if (buffer.type !== "normal") return null;
    // Erasing/redrawing a line need not dispose its xterm marker. Never treat
    // the old column as a new prompt if its prefix no longer matches.
    if (buffer.getLine(marker.line)?.translateToString(false, 0, this.col) !== this.prefix) {
      this.clear();
      return null;
    }
    return { row: marker.line, col: this.col };
  }

  resize(columns: number, resize: () => void): void {
    if (columns !== this.term.cols) {
      const prompt = this.position();
      // xterm deliberately leaves the current logical line for the shell to
      // redraw on width changes. It can truncate a draft: only carry a proven
      // empty, non-clipped prompt through reflow of preceding output.
      if (!prompt || columns <= prompt.col || this.term.options.reflowCursorLine
        || !inspectPromptReadiness(this.term.buffer.active, prompt).ready) this.clear();
    }
    try {
      resize();
    } finally {
      this.columns = this.term.cols;
    }
  }

  clear(): void {
    this.marker?.dispose();
    this.marker = undefined;
  }
}
