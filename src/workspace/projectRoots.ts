import { useSyncExternalStore } from "react";

/**
 * Pinned project roots — user-declared folders that bucket everything beneath
 * them into one workspace root (and one timeline), git or not. Resolution
 * order in the workspace store: pinned root → git top-level → exact folder.
 */

const LS_KEY = "huskv2.projectRoots";

function load(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

let roots: string[] = load();
const subscribers = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(roots));
  } catch {
    // ignore
  }
}

function emit(): void {
  for (const fn of subscribers) fn();
}

export function getProjectRoots(): string[] {
  return roots;
}

export function subscribeProjectRoots(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function useProjectRoots(): string[] {
  return useSyncExternalStore(subscribeProjectRoots, getProjectRoots);
}

export function addProjectRoot(path: string): void {
  if (!path || roots.includes(path)) return;
  roots = [...roots, path];
  persist();
  emit();
}

export function removeProjectRoot(path: string): void {
  if (!roots.includes(path)) return;
  roots = roots.filter((r) => r !== path);
  persist();
  emit();
}

/** Deepest pinned root containing `path` (or equal to it), else null. Longest
    match wins so nested roots (~/work inside ~) resolve to the inner one. */
export function findProjectRoot(path: string): string | null {
  let best: string | null = null;
  for (const r of roots) {
    if (path === r || path.startsWith(`${r}/`)) {
      if (!best || r.length > best.length) best = r;
    }
  }
  return best;
}
