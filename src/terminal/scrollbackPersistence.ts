import type { IMarker, Terminal } from "@xterm/xterm";
import { getPrefs, subscribePrefs } from "../settings/preferences";
import { toast } from "../toast";
import { scrollbackArchive, sanitizeScrollbackRow, ScrollbackArchiveChangedError, SCROLLBACK_ARCHIVE_LIMITS, type ScrollbackArchive } from "./scrollbackArchive";

type Options = { enabled: boolean; retentionDays: number };
const SAVE_INTERVAL_MS = 5_000;
const sessions = new Set<TerminalScrollbackPersistence>();
const pendingDeletions = new Set<Promise<boolean>>();
let lifecycleInstalled = false;
const currentOptions = (): Options => ({ enabled: getPrefs().terminalRestoreScrollback === true, retentionDays: getPrefs().terminalScrollbackRetentionDays });

/** Read only the rendered normal buffer. Nothing from this path enters the
 * native output observer, command markers, bridge, or PTY input channel. */
export function snapshotTerminalRows(term: Terminal, floor = 0): string[] {
  const buffer = term.buffer.normal;
  const end = Math.min(buffer.length, buffer.baseY + term.rows);
  const rows: string[] = [];
  let chars = 0;
  for (let row = end - 1; row >= Math.max(floor, end - SCROLLBACK_ARCHIVE_LIMITS.rows); row--) {
    const text = buffer.getLine(row)?.translateToString(true) ?? "";
    if (!rows.length && !text) continue;
    // UTF-8 limits are enforced again by storage. Bound work before encoding.
    if (chars + text.length + 1 > SCROLLBACK_ARCHIVE_LIMITS.snapshotBytes) break;
    rows.push(text);
    chars += text.length + 1;
  }
  return rows.reverse();
}

export class TerminalScrollbackPersistence {
  restored = false;
  private initialized = false;
  private disposed = false;
  private blocked = false;
  private dirty = false;
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private saving: Promise<boolean> | undefined;
  private baseline: IMarker | undefined;
  private resetOnNormal = false;
  private listeners: Array<() => void> = [];
  private warned = false;
  private accessedStorage = false;
  private finishRestore: (() => void) | undefined;

  constructor(private term: Terminal, readonly key: string, private options: Options,
    private archive: ScrollbackArchive = scrollbackArchive,
    private report: (message: string) => void = message => {
      toast({ title: "Terminal history", message, variant: "warning", duration: 10_000 });
    }) {
    const output = term.onWriteParsed(() => {
      if (!this.initialized || this.disposed || !this.options.enabled || this.blocked || term.buffer.active.type !== "normal") return;
      this.dirty = true;
      this.schedule();
    });
    const buffer = term.buffer.onBufferChange(() => {
      if (this.resetOnNormal && term.buffer.active.type === "normal") this.resetBaseline();
    });
    this.listeners.push(() => output.dispose(), () => buffer.dispose(), archive.subscribeDeletion(key => {
      if (key !== null && key !== this.key) return;
      this.generation++;
      this.cancelTimer();
      this.dirty = false;
      this.blocked = false;
      this.resetBaseline();
    }));
  }

  private resetBaseline() {
    this.baseline?.dispose();
    this.baseline = undefined;
    this.resetOnNormal = this.term.buffer.active.type !== "normal";
    if (!this.resetOnNormal) {
      // Start after the last existing visible row, not just the cursor (which
      // may be at Home). This avoids re-saving rows the user just deleted.
      const buffer = this.term.buffer.normal;
      let last = buffer.baseY + buffer.cursorY;
      for (let row = buffer.length - 1; row > last; row--) {
        if (buffer.getLine(row)?.translateToString(true)) { last = row; break; }
      }
      this.baseline = this.term.registerMarker(last - buffer.baseY - buffer.cursorY);
    }
  }

  private warn(message: string) { if (!this.warned) { this.warned = true; this.report(message); } }
  private cancelTimer() { clearTimeout(this.timer); this.timer = undefined; }
  private schedule() {
    if (!this.timer && !this.disposed) this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, SAVE_INTERVAL_MS);
  }

  async initialize(restore: boolean): Promise<void> {
    const generation = this.generation;
    try {
      if (this.options.enabled) {
        this.accessedStorage = true;
        const saved = await this.archive.read(this.key, this.options);
        if (this.disposed || !this.options.enabled || generation !== this.generation) return;
        if (restore && saved?.rows.length) {
          // Defend even against a faulty/corrupt archive implementation. No
          // stored escapes, tabs, OSC payloads, or controls enter xterm.
          const rows = saved.rows.slice(-Math.min(SCROLLBACK_ARCHIVE_LIMITS.rows, Math.max(0, this.term.options.scrollback ?? 0))).map(sanitizeScrollbackRow);
          if ((this.term.options.scrollback ?? 0) > 0 && rows.length) {
            if (Number.isSafeInteger(saved.cols) && saved.cols! >= 2 && saved.cols! <= 4096) this.term.resize(saved.cols!, this.term.rows);
            const stamp = new Date(saved.savedAt).toISOString();
            await new Promise<void>(resolve => {
              const finish = () => { this.finishRestore = undefined; resolve(); };
              this.finishRestore = finish;
              this.term.write(`${rows.join("\r\n")}\r\n[Restored output · ${stamp}]\r\n[New shell · commands are not replayed]\r\n`, finish);
            });
            if (this.disposed) return;
            if (!this.options.enabled || generation !== this.generation) {
              // Startup restoration is still before PTY attachment. Clear only
              // that staged display after queued writes drain; reset earlier
              // would let a pending xterm write repaint deleted history.
              this.term.reset();
              return;
            }
            this.restored = true;
          }
        }
      }
    } catch {
      this.blocked = true;
      this.warn("Previous output could not be restored. The shell will still start; the saved snapshot has not been replaced. Restart Husk to retry restoring it.");
    } finally { this.initialized = true; }
  }

  configure(options: Options): void {
    const previous = this.options;
    this.options = options;
    if (!options.enabled) {
      this.generation++;
      this.cancelTimer();
      this.dirty = false;
      return;
    }
    if (!previous.enabled) {
      this.blocked = false;
      this.warned = false;
      this.initialized = false;
      void this.initialize(false).then(() => {
        if (this.disposed || this.blocked || !this.options.enabled) return;
        this.dirty = true;
        this.schedule();
      });
    }
  }

  async flush(): Promise<boolean> {
    this.cancelTimer();
    if (this.saving) return this.saving;
    if (!this.dirty || this.disposed || !this.options.enabled || !this.initialized || this.blocked || this.resetOnNormal) return true;
    const floor = this.baseline && !this.baseline.isDisposed ? this.baseline.line + 1 : 0;
    const rows = snapshotTerminalRows(this.term, floor);
    if (!rows.length) { this.dirty = false; return true; }
    const generation = this.generation;
    this.dirty = false;
    this.saving = (async () => {
      try {
        await this.archive.save(this.key, rows, { ...this.options, cols: this.term.cols });
        this.warned = false;
        return true;
      } catch (error) {
        if (error instanceof ScrollbackArchiveChangedError) {
          // Deletion in another window wins. Never retry the old snapshot.
          this.resetBaseline();
          this.dirty = false;
          return true;
        }
        if (!this.disposed && this.options.enabled && generation === this.generation) {
          this.dirty = true;
          this.warn("Recent output could not be saved. It remains visible in this terminal; check available storage and retry before quitting.");
        }
        return false;
      } finally {
        this.saving = undefined;
        if (this.dirty && !this.disposed && this.options.enabled) this.schedule();
      }
    })();
    return this.saving;
  }

  async erase(): Promise<void> { await this.archive.delete(this.key); }
  dispose(deleteSaved = true): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finishRestore?.();
    this.cancelTimer();
    for (const listener of this.listeners) listener();
    this.listeners = [];
    this.baseline?.dispose();
    sessions.delete(this);
    if (deleteSaved && this.accessedStorage) {
      const deletion = this.erase().then(() => true, () => {
        this.report("The closed pane's saved history could not be deleted. Use Delete saved terminal history in Settings to retry.");
        return false;
      });
      pendingDeletions.add(deletion);
      void deletion.finally(() => pendingDeletions.delete(deletion));
    }
  }
}

/** Used by the existing native close guard, not a competing window closer. */
export async function flushTerminalHistories(): Promise<boolean> {
  const results = await Promise.all([...sessions].map(session => session.flush()).concat([...pendingDeletions]));
  return results.every(Boolean);
}

export function createTerminalHistory(term: Terminal, key: string): TerminalScrollbackPersistence {
  if (!lifecycleInstalled && typeof window !== "undefined") {
    lifecycleInstalled = true;
    let previous = currentOptions();
    subscribePrefs(() => {
      const options = currentOptions();
      for (const session of sessions) session.configure(options);
      if (previous.enabled && !options.enabled) void scrollbackArchive.clearAll().catch(() => {
        toast({ title: "Terminal history", message: "Recording is off, but saved output could not be deleted. Retry deletion in Settings.", variant: "error", duration: 10_000 });
      });
      if (options.enabled && options.retentionDays !== previous.retentionDays) void scrollbackArchive.prune(options).catch(() => {
        toast({ title: "Terminal history", message: "Saved output could not be pruned. Retry deletion in Settings.", variant: "warning" });
      });
      previous = options;
    });
    const flush = () => { void flushTerminalHistories(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    setInterval(() => {
      const options = currentOptions();
      if (options.enabled) void scrollbackArchive.prune(options).catch(() => {
        toast({ title: "Terminal history", message: "Expired history could not be removed. Retry deletion in Settings.", variant: "warning" });
      });
    }, 60 * 60 * 1_000);
  }
  const session = new TerminalScrollbackPersistence(term, key, currentOptions());
  sessions.add(session);
  return session;
}
