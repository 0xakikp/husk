import { invoke } from "@tauri-apps/api/core";

export type HistoryRow = { command: string; timestamp: number | null };

/** Most-recent-first, de-duplicated commands from the user's shell history. */
export const getShellHistory = (limit = 2000) =>
  invoke<HistoryRow[]>("pty_shell_history", { home_dir: null, limit });
