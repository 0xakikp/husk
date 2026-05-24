import { useSyncExternalStore } from "react";
import { open } from "@tauri-apps/plugin-dialog";

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

/** Open a native folder picker and set it as the workspace root. */
export async function pickWorkspaceFolder(): Promise<void> {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked === "string") setWorkspaceRoot(picked);
}
