import { useSyncExternalStore } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { runInActiveTerminal } from "../ai/terminalContext";
import { shq } from "../lib/shellQuote";

const LS_KEY = "huskv2.workspaceRoot";

let root = "";
try {
  root = localStorage.getItem(LS_KEY) || "";
} catch {
  root = "";
}

const subscribers = new Set<() => void>();

export function getWorkspaceRoot(): string {
  return root;
}

export function setWorkspaceRoot(path: string): void {
  root = path;
  try {
    localStorage.setItem(LS_KEY, path);
  } catch {
    // ignore
  }
  for (const fn of subscribers) fn();
}

export function useWorkspaceRoot(): string {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => root,
  );
}

/** Switch the workspace to `path`: set the root AND cd the active terminal into
 *  it. The explorer roots off the active terminal's cwd, so cd-ing the terminal
 *  is what makes the file tree follow. The cd is a no-op if no terminal is live
 *  yet (the root still updates as the fallback). */
export function gotoWorkspace(path: string): void {
  setWorkspaceRoot(path);
  runInActiveTerminal(`cd ${shq(path)}`);
}

/** Open a native folder picker and switch the workspace to it. */
export async function pickWorkspaceFolder(): Promise<void> {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked === "string") gotoWorkspace(picked);
}
