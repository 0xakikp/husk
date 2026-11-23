import { invoke } from "@tauri-apps/api/core";
import { byteLength, scanForSecrets } from "./ai/contextItems";

export type HistoryRow = { command: string; timestamp: number | null; source?: string };

export const MAX_SHELL_HISTORY_ENTRIES = 10_000;
export const MAX_SESSION_HISTORY_ENTRIES = 1000;
export const MAX_SESSION_HISTORY_BYTES = 256 * 1024;
export const MAX_SESSION_HISTORY_COMMAND_BYTES = 4096;

/** Most-recent-first, de-duplicated commands from the user's shell history. */
export const getShellHistory = (limit = MAX_SHELL_HISTORY_ENTRIES) =>
  invoke<HistoryRow[]>("pty_shell_history", { home_dir: null, limit });

/** This is an ephemeral convenience buffer, not a second shell history file.
 * Skip commands deliberately prefixed with whitespace, internal hooks and
 * likely credentials to respect common history-exclusion conventions. This
 * cannot infer every custom HISTIGNORE rule; nothing is written to disk. */
export class SessionCommandHistory {
  private rows: Array<HistoryRow & { bytes: number }> = [];
  private bytes = 0;

  record(rawCommand: string, at = Date.now()): void {
    if (!rawCommand || /^\s/.test(rawCommand) || rawCommand.length > MAX_SESSION_HISTORY_COMMAND_BYTES
      || /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/.test(rawCommand)
      || !Number.isFinite(at) || at < 0) return;
    const command = rawCommand.trimEnd();
    if (!command || /^(?:#|builtin\s|_+husk(?:\b|_))/.test(command)
      || /^sh\s+-c\s.*\bhusk-workflow(?:\s|$)/.test(command)
      || scanForSecrets("history", command).length
      || /\b[\w]*(?:token|password|passwd|secret|api_key|credential)[\w]*\s*=/i.test(command)
      || /--(?:password|passwd|token|api-key|secret)(?:=|\s)/i.test(command)
      || /\b(?:curl|wget)\b.*\s(?:-u|--user)(?:=|\s)/i.test(command)
      || /[a-z][a-z\d+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(command)) return;
    const bytes = byteLength(command);
    if (bytes > MAX_SESSION_HISTORY_COMMAND_BYTES) return;
    const previous = this.rows.findIndex((row) => row.command === command);
    if (previous !== -1) this.bytes -= this.rows.splice(previous, 1)[0].bytes;
    this.rows.unshift({ command, timestamp: Math.floor(at / 1000), source: "This terminal session", bytes });
    this.bytes += bytes;
    while (this.rows.length > MAX_SESSION_HISTORY_ENTRIES || this.bytes > MAX_SESSION_HISTORY_BYTES) {
      this.bytes -= this.rows.pop()!.bytes;
    }
  }

  snapshot(): HistoryRow[] {
    return this.rows.map(({ command, timestamp, source }) => ({ command, timestamp, source }));
  }

  clear(): void { this.rows = []; this.bytes = 0; }
}

/** Both inputs are newest-first. Preserve file order when dates are unknown;
 * compare known dates when interleaving, and never replace a newer persisted
 * occurrence with an older in-memory duplicate. */
export function mergeShellHistory(liveRows: readonly HistoryRow[], diskRows: readonly HistoryRow[]): HistoryRow[] {
  const persisted = new Map<string, HistoryRow>();
  for (const row of diskRows.slice(0, MAX_SHELL_HISTORY_ENTRIES)) {
    if (!row.command.trim()) continue;
    const previous = persisted.get(row.command);
    if (!previous || (row.timestamp != null && (previous.timestamp == null || row.timestamp > previous.timestamp))) {
      persisted.set(row.command, { ...row, source: row.source ?? "Local shell history" });
    }
  }
  const live = new Map<string, HistoryRow>();
  for (const row of liveRows.slice(0, MAX_SESSION_HISTORY_ENTRIES)) {
    if (!row.command.trim() || live.has(row.command)) continue;
    const stored = persisted.get(row.command);
    if (stored?.timestamp != null && row.timestamp != null && stored.timestamp > row.timestamp) continue;
    live.set(row.command, { ...row });
    persisted.delete(row.command);
  }
  const pendingLive = [...live.values()];
  const pendingDisk = [...persisted.values()];
  const merged: HistoryRow[] = [];
  let liveIndex = 0;
  let diskIndex = 0;
  while (merged.length < MAX_SHELL_HISTORY_ENTRIES && (liveIndex < pendingLive.length || diskIndex < pendingDisk.length)) {
    const current = pendingLive[liveIndex];
    const stored = pendingDisk[diskIndex];
    if (stored && (!current || (stored.timestamp != null && current.timestamp != null && stored.timestamp > current.timestamp))) {
      merged.push(stored); diskIndex++;
    } else {
      merged.push(current); liveIndex++;
    }
  }
  return merged;
}
