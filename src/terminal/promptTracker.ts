import type { IMarker, Terminal } from "@xterm/xterm";
import { absolutePromptPosition, inspectPromptReadiness, type PromptDecoration, type PromptPosition, type PromptReadiness } from "./promptDraft";

/** An OSC 133 B boundary belongs to a buffer line, not a fixed screen row.
 * xterm markers follow output reflow and scrollback trimming. They do not track
 * columns or shell input, so uncertain redraws still require a fresh B. */
export class TerminalPromptTracker {
  private marker: IMarker | undefined;
  private col = 0;
  private columns = 0;
  private prefix = "";
  private rightPromptOpen = false;
  private rightPromptStart: PromptPosition | null = null;
  private decoration: Omit<PromptDecoration, "row"> | undefined;

  constructor(private readonly term: Terminal) {}

  /** Some themes also terminate RPROMPT with B. It closes a decoration, not
   * the editable left prompt. Consume it before command-boundary processing. */
  observeRightPrompt(data: string): boolean {
    const [kind, ...parameters] = data.split(";");
    if (kind === "P" && parameters.includes("k=r")) {
      this.decoration = undefined;
      const prompt = this.position();
      const cursor = absolutePromptPosition(this.term.buffer.active);
      this.rightPromptOpen = true;
      this.rightPromptStart = prompt && cursor.row === prompt.row && cursor.col > prompt.col ? cursor : null;
      return true;
    }
    if (kind !== "B" || !this.rightPromptOpen) {
      if (["A", "C", "D", "P"].includes(kind)) {
        this.rightPromptOpen = false;
        this.rightPromptStart = null;
      }
      return false;
    }
    this.rightPromptOpen = false;
    const start = this.rightPromptStart;
    this.rightPromptStart = null;
    const prompt = this.position();
    const end = absolutePromptPosition(this.term.buffer.active);
    if (!start || !prompt || start.row !== prompt.row || end.row !== prompt.row
      || end.col <= start.col || end.col > this.term.cols || end.col - start.col > 4096) return true;
    const line = this.term.buffer.active.getLine(end.row);
    const cells: string[] = [];
    for (let col = start.col; col < end.col; col++) {
      const cell = line?.getCell(col);
      if (!cell) return true;
      cells.push(cell.getChars());
    }
    this.decoration = { start: start.col, cells };
    return true;
  }

  /** A subsequent keystroke/paste cannot reuse decoration as proof that shell
   * input is still empty, even if it later paints identical text at Home. */
  noteInput(): void {
    this.decoration = undefined;
    this.rightPromptStart = null;
  }

  readiness(): PromptReadiness {
    const prompt = this.position();
    return inspectPromptReadiness(this.term.buffer.active, this.rightPromptOpen ? null : prompt,
      prompt && this.decoration ? { ...this.decoration, row: prompt.row } : undefined);
  }

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
      this.invalidateAnchor();
      return null;
    }
    const buffer = this.term.buffer.active;
    if (buffer.type !== "normal") return null;
    // Erasing/redrawing a line need not dispose its xterm marker. Never treat
    // the old column as a new prompt if its prefix no longer matches.
    if (buffer.getLine(marker.line)?.translateToString(false, 0, this.col) !== this.prefix) {
      this.invalidateAnchor();
      return null;
    }
    return { row: marker.line, col: this.col };
  }

  resize(columns: number, resize: () => void): void {
    if (columns !== this.term.cols) {
      this.noteInput();
      const prompt = this.position();
      // xterm deliberately leaves the current logical line for the shell to
      // redraw on width changes. It can truncate a draft: only carry a proven
      // empty, non-clipped prompt through reflow of preceding output.
      if (!prompt || columns <= prompt.col || this.term.options.reflowCursorLine
        || !inspectPromptReadiness(this.term.buffer.active, prompt).ready) this.invalidateAnchor();
    }
    try {
      resize();
    } finally {
      this.columns = this.term.cols;
    }
  }

  clear(): void {
    this.rightPromptOpen = false;
    this.invalidateAnchor();
  }

  private invalidateAnchor(): void {
    // A right prompt may arrive across several output chunks. Losing the left
    // anchor must not reinterpret that right span's later B as an input mark.
    this.noteInput();
    this.marker?.dispose();
    this.marker = undefined;
  }
}
