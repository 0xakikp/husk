import { invoke } from "@tauri-apps/api/core";
import { tokenizeCommand } from "../lib/shellQuote";

export type BgJob = {
  handle: number;
  command: string;
  cwd: string | null;
  started_at_ms: number;
  exited: boolean;
  exit_code: number | null;
};

export type BgLog = {
  bytes: string;
  next_offset: number;
  dropped: number;
  exited: boolean;
  exit_code: number | null;
};

export const bgSpawn = (command: string, cwd?: string | null) => {
  const tokens = tokenizeCommand(command.trim());
  const [program, ...args] = tokens;
  if (!program) return Promise.reject(new Error("empty command"));
  return invoke<number>("shell_bg_spawn", { program, args, cwd: cwd ?? null });
};

export const bgLogs = (handle: number, since_offset = 0) =>
  invoke<BgLog>("shell_bg_logs", { handle, since_offset });

export const bgKill = (handle: number) => invoke<void>("shell_bg_kill", { handle });
export const bgRemove = (handle: number) => invoke<void>("shell_bg_remove", { handle });
export const bgList = () => invoke<BgJob[]>("shell_bg_list");
