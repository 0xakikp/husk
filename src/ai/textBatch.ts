/** Coalesce token-sized updates without delaying final/error/tool transitions.
 * The queue has a hard size bound and owns exactly one cancellable timer. */
export class TextBatch {
  private chunks: string[] = [];
  private size = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  static readonly MAX_CHARS = 16 * 1024;
  static readonly DELAY_MS = 50;

  constructor(
    private readonly publish: (text: string) => void,
    private readonly current: () => boolean,
    private readonly signal: AbortSignal,
  ) {
    if (signal.aborted) this.disposed = true;
    else signal.addEventListener("abort", this.dispose, { once: true });
  }

  push(text: string) {
    if (this.disposed || !this.current()) return;
    for (let offset = 0; offset < text.length;) {
      const piece = text.slice(offset, offset + TextBatch.MAX_CHARS - this.size);
      this.chunks.push(piece);
      this.size += piece.length;
      offset += piece.length;
      if (this.size === TextBatch.MAX_CHARS) this.flush();
      if (this.disposed || !this.current()) return;
    }
    if (this.size && this.timer === undefined) this.timer = setTimeout(() => this.flush(), TextBatch.DELAY_MS);
  }

  flush = () => {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    const text = this.chunks.join("");
    this.chunks = [];
    this.size = 0;
    if (text && !this.disposed && this.current()) this.publish(text);
  };

  dispose = () => {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.chunks = [];
    this.size = 0;
    this.signal.removeEventListener("abort", this.dispose);
  };
}
