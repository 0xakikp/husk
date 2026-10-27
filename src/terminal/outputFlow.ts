/** One native credit window per PTY. ACK only bytes already parsed by xterm,
 * not merely received by the event handler or queued in Terminal.write(). */
export type NativeTerminalOutput = { sequence: number; bytes: number[] };

export class TerminalOutputFlow {
  private received = 0;
  private parsed = 0;
  private acknowledged = 0;
  private completed = new Set<number>();
  private inFlight: Promise<void> | null = null;
  private disposed = false;
  private failure: unknown = null;
  private renderFailure: unknown = null;
  private scheduled = false;

  constructor(
    private render: (bytes: number[], parsed: () => void) => void,
    private acknowledge: (sequence: number) => Promise<unknown>,
    private onError: (error: unknown) => void,
  ) {}

  get failed(): boolean { return this.failure !== null || this.renderFailure !== null; }

  accept(packet: NativeTerminalOutput): void {
    if (this.disposed || this.renderFailure) return;
    if (!packet || typeof packet !== "object" || !Number.isSafeInteger(packet.sequence) || packet.sequence < 1
      || !Array.isArray(packet.bytes) || !packet.bytes.length || packet.bytes.length > 256 * 1024) {
      this.failRender(new Error("Invalid terminal output packet. Output was paused, not restarted."));
      return;
    }
    // Duplicate delivery cannot render twice or grant credits twice.
    if (packet.sequence <= this.received) return;
    if (packet.sequence !== this.received + 1) {
      this.failRender(new Error("Terminal output arrived out of order. Output was paused to protect the stream."));
      return;
    }
    this.received = packet.sequence;
    try {
      let completed = false;
      this.render(packet.bytes, () => {
        if (completed || this.disposed || this.renderFailure) return;
        completed = true;
        this.completed.add(packet.sequence);
        while (this.completed.delete(this.parsed + 1)) this.parsed += 1;
        // xterm may complete several writes in one parser turn. Return one
        // cumulative ACK instead of one IPC request for each small PTY read.
        if (!this.scheduled) {
          this.scheduled = true;
          queueMicrotask(() => {
            this.scheduled = false;
            void this.flush().catch(() => {});
          });
        }
      });
    } catch (error) { this.failRender(error); }
  }

  private failRender(error: unknown): void {
    this.renderFailure = error;
    this.onError(error);
  }

  flush(retry = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.renderFailure) return Promise.reject(this.renderFailure);
    if (this.inFlight) return this.inFlight;
    if (retry) this.failure = null;
    if (this.failure) return Promise.reject(this.failure);
    const operation = (async () => {
      while (!this.disposed && this.acknowledged < this.parsed) {
        const sequence = this.parsed;
        await this.acknowledge(sequence);
        this.acknowledged = sequence;
      }
    })().catch(error => {
      if (!this.disposed) {
        this.failure = error;
        this.onError(error);
      }
      throw error;
    });
    this.inFlight = operation;
    void operation.finally(() => { if (this.inFlight === operation) this.inFlight = null; }).catch(() => {});
    return operation;
  }

  dispose(): void {
    this.disposed = true;
    this.completed.clear();
  }
}
