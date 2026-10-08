/** Connection health is not shell/prompt readiness. Never send commands as probes. */
export type NativeTerminalStatus = {
  state: "running" | "exited" | "disconnected";
  message?: string;
};
export type TerminalSessionStatus = {
  state: "starting" | "ready" | "slow-start" | "exited" | "disconnected" | "unresponsive" | "error";
  message?: string;
};

export interface TerminalTransport {
  spawn(): Promise<number>;
  listenData(id: number, callback: (data: number[]) => void): Promise<() => void>;
  listenExit(id: number, callback: (status: NativeTerminalStatus | null) => void): Promise<() => void>;
  attach(id: number): Promise<NativeTerminalStatus>;
  status(id: number): Promise<NativeTerminalStatus>;
  write(id: number, data: string): Promise<unknown>;
  kill(id: number): Promise<unknown>;
}

export const STARTING_TERMINAL: TerminalSessionStatus = { state: "starting" };
const STARTUP_NOTICE_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_PENDING_INPUT = 256 * 1024;

export function boundedTerminalRequest<T>(operation: Promise<T>, milliseconds = REQUEST_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The terminal did not respond in time.")), milliseconds);
    operation.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}
const bounded = boundedTerminalRequest;
function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 800);
}

/** One generation per explicitly started shell. Late IPC results cannot revive
 * a closed/restarted tab. Output, checks and errors never automatically restart it. */
export class TerminalSessionConnection {
  status: TerminalSessionStatus = STARTING_TERMINAL;
  id: number | null = null;
  private generation = 0;
  private disposed = false;
  private unlisteners: (() => void)[] = [];
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private receivedOutput = false;
  private startedAt = 0;
  private attached = false;
  private nativeAttached = false;
  private listenersRegistered = false;
  private attaching: Promise<void> | null = null;
  private attachmentEpoch = 0;
  private checking: Promise<void> | null = null;
  private pendingInput: { data: string; expires: number; size: number }[] = [];
  private pendingBytes = 0;
  private writing = false;

  constructor(
    private transport: TerminalTransport,
    private onData: (data: number[]) => void,
    private onChange: () => void,
  ) {}

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation;
  }
  private publish(status: TerminalSessionStatus): void {
    this.status = status;
    this.onChange();
  }
  private releaseListeners(): void {
    for (const unlisten of this.unlisteners.splice(0)) unlisten();
  }
  private applyNative(status: NativeTerminalStatus): void {
    if (status.state !== "running") {
      clearTimeout(this.startupTimer);
      this.pendingInput = [];
      this.pendingBytes = 0;
      this.publish({ state: status.state, message: status.message });
    } else if (this.status.state !== "exited") {
      this.publish(this.receivedOutput ? { state: "ready" } : {
        state: Date.now() - this.startedAt >= STARTUP_NOTICE_MS ? "slow-start" : "starting",
        message: "Waiting for shell output. Shell startup files may still be loading.",
      });
    }
  }

  async start(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.receivedOutput = false;
    this.startedAt = Date.now();
    this.attached = false;
    this.nativeAttached = false;
    this.listenersRegistered = false;
    this.publish(STARTING_TERMINAL);
    clearTimeout(this.startupTimer);
    this.startupTimer = setTimeout(() => {
      if (this.current(generation) && this.status.state === "starting") this.publish({
        state: "slow-start", message: "Shell startup is taking longer than expected. No commands have been sent or restarted.",
      });
    }, STARTUP_NOTICE_MS);
    try {
      // Do not abandon a spawn promise: a late result must be closed if its tab
      // was explicitly closed/restarted, rather than leaking an orphan shell.
      const id = await this.transport.spawn();
      if (!this.current(generation)) { await this.transport.kill(id); return; }
      this.id = id;
      this.onChange();
      await this.attach(generation, id);
    } catch (error) {
      if (this.current(generation)) {
        if (!this.listenersRegistered) clearTimeout(this.startupTimer);
        this.publish({ state: "error", message: `Could not connect to the shell. ${message(error)}` });
      }
    }
  }

  private attach(generation: number, id: number): Promise<void> {
    if (this.attaching) return this.attaching;
    const epoch = this.listenersRegistered ? this.attachmentEpoch : ++this.attachmentEpoch;
    const valid = () => this.current(generation) && epoch === this.attachmentEpoch;
    const operation = (async () => {
      if (!this.listenersRegistered) {
        this.releaseListeners();
        const register = async (subscription: Promise<() => void>) => {
          const unlisten = await subscription;
          if (valid()) this.unlisteners.push(unlisten);
          else unlisten();
        };
        await bounded(Promise.all([
          register(this.transport.listenData(id, (data) => {
            if (!valid()) return;
            if (data.length) {
              this.receivedOutput = true;
              clearTimeout(this.startupTimer);
              if (this.status.state === "starting" || this.status.state === "slow-start") this.publish({ state: "ready" });
              this.onData(data);
            }
          })),
          register(this.transport.listenExit(id, (status) => {
            if (valid()) this.applyNative(status ?? { state: "exited" });
          })),
        ]));
        if (!valid()) return;
        this.listenersRegistered = true;
      }
      // Both listeners exist. xterm may answer a terminal query from buffered
      // startup output before the attach response returns; allow that reply.
      this.attached = true;
      // A delayed acknowledgement must not invalidate subscribed output. A
      // paused webview may receive its first prompt after this request times out.
      await bounded(this.transport.attach(id).then((status) => {
        if (valid()) { this.nativeAttached = true; this.applyNative(status); }
        return status;
      }));
    })().catch((error: unknown) => {
      if (valid() && !this.listenersRegistered) {
        this.attached = false;
        ++this.attachmentEpoch;
        this.releaseListeners();
      }
      throw error;
    });
    this.attaching = operation;
    void operation.finally(() => { if (this.attaching === operation) this.attaching = null; }).catch(() => {});
    return operation;
  }

  check(): Promise<void> {
    if (this.checking) return this.checking;
    if (this.disposed || this.id === null) return Promise.resolve();
    const generation = this.generation;
    const id = this.id;
    const operation = (async () => {
      try {
        if (!this.nativeAttached) await this.attach(generation, id);
        const status = await bounded(this.transport.status(id));
        if (this.current(generation)) this.applyNative(status);
      } catch (error) {
        if (this.current(generation) && this.status.state !== "exited") this.publish({
          state: "unresponsive", message: `${message(error)} Your shell has not been restarted.`,
        });
      }
    })();
    this.checking = operation;
    void operation.finally(() => { if (this.checking === operation) this.checking = null; });
    return operation;
  }

  write(data: string): boolean {
    if (!data || this.disposed || this.id === null || !this.attached) return false;
    if (!["ready", "starting", "slow-start"].includes(this.status.state)) return false;
    const size = new TextEncoder().encode(data).length;
    if (size + this.pendingBytes > MAX_PENDING_INPUT) {
      this.pendingInput = [];
      this.pendingBytes = 0;
      this.publish({ state: "unresponsive", message: "Too much pending terminal input. Unsent input was dropped, not replayed. Check the prompt before typing again." });
      return false;
    }
    this.pendingInput.push({ data, size, expires: Date.now() + REQUEST_TIMEOUT_MS });
    this.pendingBytes += size;
    void this.flushInput();
    return true;
  }
  private async flushInput(): Promise<void> {
    if (this.writing || this.id === null) return;
    this.writing = true;
    const generation = this.generation;
    const id = this.id;
    try {
      while (this.current(generation) && this.pendingInput.length) {
        const next = this.pendingInput.shift()!;
        this.pendingBytes -= next.size;
        if (Date.now() >= next.expires) throw new Error("Pending input expired while the terminal was unavailable.");
        await bounded(this.transport.write(id, next.data));
      }
    } catch (error) {
      if (this.current(generation)) {
        this.pendingInput = [];
        this.pendingBytes = 0;
        this.publish({ state: "unresponsive", message: `${message(error)} Input may be partially sent; it will not be replayed. Check the prompt before typing again.` });
      }
    } finally {
      if (this.current(generation)) this.writing = false;
    }
  }

  /** Caller must get explicit confirmation before ending an existing shell. */
  async restart(beforeStart?: () => void): Promise<void> {
    if (this.disposed) return;
    const id = this.id;
    const generation = ++this.generation;
    clearTimeout(this.startupTimer);
    this.releaseListeners();
    this.attached = false;
    this.nativeAttached = false;
    this.listenersRegistered = false;
    this.pendingInput = [];
    this.pendingBytes = 0;
    this.writing = false;
    this.attaching = null;
    this.checking = null;
    this.id = null;
    this.publish(STARTING_TERMINAL);
    if (id !== null) {
      try { await bounded(this.transport.kill(id)); }
      catch (error) {
        if (!this.current(generation)) return;
        this.id = id;
        this.publish({ state: "error", message: `Could not close the previous shell. A replacement was not started. ${message(error)}` });
        return;
      }
    }
    if (!this.current(generation)) return;
    beforeStart?.();
    await this.start();
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.startupTimer);
    this.releaseListeners();
    this.pendingInput = [];
    this.pendingBytes = 0;
    if (this.id !== null) void this.transport.kill(this.id).catch(() => {});
    this.id = null;
  }
}
