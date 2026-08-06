import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getActiveTerminalCwd, runInActiveTerminal } from "../ai/terminalContext";
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

export function subscribeWorkspaceRoot(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
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
export async function pickWorkspaceFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return null;
  gotoWorkspace(picked);
  return picked;
}

/** Sync the workspace root to the active terminal's cwd (OSC 7, local shells
    only — remote shells don't map to local folders). Manual picks still work:
    gotoWorkspace cd-s the terminal, which reports its new cwd right back here,
    so both directions converge instead of drifting apart.

    Git-root keying: inside a repository the root is the repo top-level, so a
    whole project shares one timeline no matter how deep you cd. Outside repos
    the folder itself is the root (home, /tmp scratch buckets). */
export function syncWorkspaceRootToCwd(cwd: string): void {
  if (!cwd) return;
  /* Skip the git probe only when this cwd is already resolved AND applied —
     a persisted root that merely equals cwd has not been git-resolved yet. */
  const known = gitRootCache.get(cwd);
  if (known && known === root) return;
  void resolveGitRoot(cwd).then((resolved) => {
    /* Race guard: the user may have cd-d again while git was resolving. Apply
       only when the terminal is still inside the resolved root — deeper into
       the same repo counts, a different tree does not. */
    const nowCwd = getActiveTerminalCwd();
    if (nowCwd === resolved || nowCwd.startsWith(`${resolved}/`)) {
      if (resolved !== root) setWorkspaceRoot(resolved);
    }
  });
}

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

const gitRootCache = new Map<string, string>();
const gitRootInflight = new Map<string, Promise<string>>();

/** Repo top-level for `cwd`, or `cwd` itself when not inside a repository.
    Cached per path and deduped in-flight — OSC 7 fires on every prompt. */
function resolveGitRoot(cwd: string): Promise<string> {
  const cached = gitRootCache.get(cwd);
  if (cached) return Promise.resolve(cached);
  const inflight = gitRootInflight.get(cwd);
  if (inflight) return inflight;
  const p = invoke<ShellOutput>("shell_run_command", {
    program: "git",
    args: ["-C", cwd, "rev-parse", "--show-toplevel"],
    cwd: null,
    timeout_secs: 3,
  })
    .then((out) => {
      const top = out.exit_code === 0 ? out.stdout.trim() : "";
      const resolved = top || cwd;
      gitRootCache.set(cwd, resolved);
      return resolved;
    })
    .catch(() => {
      gitRootCache.set(cwd, cwd);
      return cwd;
    })
    .finally(() => {
      gitRootInflight.delete(cwd);
    });
  gitRootInflight.set(cwd, p);
  return p;
}
