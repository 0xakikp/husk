import { invoke } from "@tauri-apps/api/core";
import { bgList, type BgJob } from "../jobs/client";
import { listContainers, type DockerContainer } from "../docker/client";
import { listContexts, currentContext } from "../kubernetes/client";
import {
  ensureNotesDirectory,
  loadNotesTree,
  getPinnedNotes,
  getRecentNotes,
  isNoteFile,
  type FileNode,
} from "../notes/store";
import { loadWorkflows, type Workflow } from "../workflows/store";
import { getWorkspaceRoot } from "../workspace/store";
import { searchWorkspace, workspaceSearchNotice } from "../explorer/search";

/* Async data loaders for the launcher, with small TTL caches so opening the
   palette doesn't re-spawn CLI calls on every keystroke. */

type CacheEntry<T> = { at: number; data: T };
const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Set<(key: string) => void>();
let cacheGeneration = 0;

/** Notify an open launcher when a stale-while-revalidate result arrives. */
export function subscribeLauncherCache(listener: (key: string) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * Stale-while-revalidate. A fresh entry is returned as-is; a stale one is still
 * returned immediately while a refresh runs in the background, so an expired TTL
 * never makes the caller wait on a CLI round-trip (kubectl alone can take 15s).
 * Only a cold miss awaits, and concurrent misses for one key share a single load
 * rather than each spawning their own subprocess.
 */
async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const refresh = (): Promise<T> => {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const generation = cacheGeneration;
    const p = load()
      .then((data) => {
        if (generation === cacheGeneration) {
          cache.set(key, { at: Date.now(), data });
          for (const listener of listeners) listener(key);
        }
        return data;
      })
      .finally(() => {
        if (inflight.get(key) === p) inflight.delete(key);
      });
    inflight.set(key, p);
    return p;
  };

  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit) {
    if (Date.now() - hit.at >= ttlMs) void refresh().catch(() => {});
    return hit.data;
  }
  return refresh();
}

export function invalidateLauncherCache() {
  cacheGeneration += 1;
  cache.clear();
  inflight.clear();
}

/* ── Notes ──────────────────────────────────────────────────────────────── */

export type NoteEntry = { path: string; name: string; rel: string; pinned: boolean };

function flattenNotes(nodes: FileNode[], root: string, out: NoteEntry[], pinned: Set<string>) {
  for (const n of nodes) {
    if (n.isDirectory) {
      if (n.children) flattenNotes(n.children, root, out, pinned);
    } else if (isNoteFile(n.name)) {
      out.push({
        path: n.path,
        name: n.name,
        rel: n.path.startsWith(root) ? n.path.slice(root.length).replace(/^\//, "") : n.path,
        pinned: pinned.has(n.path),
      });
    }
  }
}

export async function loadNoteEntries(): Promise<NoteEntry[]> {
  return cached("notes", 10_000, async () => {
    try {
      const dir = await ensureNotesDirectory();
      const tree = await loadNotesTree(dir);
      const pinnedSet = new Set(getPinnedNotes());
      const out: NoteEntry[] = [];
      flattenNotes(tree, dir, out, pinnedSet);
      // Pinned first, then recents, then alphabetical
      const recents = getRecentNotes();
      const recentIdx = new Map(recents.map((p, i) => [p, i]));
      out.sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        const ra = recentIdx.get(a.path) ?? Infinity;
        const rb = recentIdx.get(b.path) ?? Infinity;
        if (ra !== rb) return ra - rb;
        return a.rel.localeCompare(b.rel);
      });
      return out.slice(0, 200);
    } catch {
      return [];
    }
  });
}

/* ── Docker ─────────────────────────────────────────────────────────────── */

export async function loadDockerContainers(): Promise<DockerContainer[]> {
  return cached("docker", 15_000, () => listContainers().catch(() => [] as DockerContainer[]));
}

/* ── Kubernetes ─────────────────────────────────────────────────────────── */

export type K8sContextEntry = { name: string; current: boolean };

export async function loadK8sContexts(): Promise<K8sContextEntry[]> {
  return cached("k8s", 30_000, async () => {
    try {
      const [ctxs, cur] = await Promise.all([listContexts(), currentContext()]);
      return ctxs.map((name) => ({ name, current: name === cur }));
    } catch {
      return [];
    }
  });
}

/* ── Workflows ──────────────────────────────────────────────────────────── */

export function loadWorkflowEntries(): Workflow[] {
  return loadWorkflows();
}

/* ── Background jobs ────────────────────────────────────────────────────── */

export async function loadRunningJobs(): Promise<BgJob[]> {
  return cached("jobs", 8_000, async () => {
    try {
      const jobs = await bgList();
      return jobs.filter((j) => !j.exited);
    } catch {
      return [];
    }
  });
}

/* ── SSH remotes ────────────────────────────────────────────────────────── */

export async function loadSshHosts(): Promise<string[]> {
  return cached("ssh-hosts", 60_000, async () => {
    try {
      const home = await invoke<string>("home_dir");
      const content = await invoke<string>("read_file", { path: `${home}/.ssh/config` });
      const hosts: string[] = [];
      for (const line of content.split("\n")) {
        const m = line.trim().match(/^Host\s+(.+)$/i);
        if (m) {
          for (const h of m[1].split(/\s+/)) {
            if (h && !h.includes("*") && !h.includes("!")) hosts.push(h);
          }
        }
      }
      return [...new Set(hosts)];
    } catch {
      return [];
    }
  });
}

/* ── Workspace files ────────────────────────────────────────────────────── */

export type WorkspaceFileEntry = { path: string; rel: string; name: string };
export type WorkspaceFilesOutcome = { files: WorkspaceFileEntry[]; notice: string | null };

export type GrepResult = { path: string; rel: string; line: number; text: string };

export type GrepOutcome = {
  results: GrepResult[];
  notice: string | null;
};

/** Query-first, cancellable local search. Native JSON preserves unusual paths;
 * failures remain failures, and partial coverage is explained to the caller. */
export async function searchWorkspaceContents(
  query: string,
  maxResults = 50,
  root = getWorkspaceRoot(),
  signal?: AbortSignal,
): Promise<GrepOutcome> {
  if (!root || !query.trim()) return { results: [], notice: root ? null : "Open a folder to search its contents." };
  const outcome = await searchWorkspace({ root, query, mode: "contents", maxResults, signal });
  return {
    results: outcome.results.flatMap((result) => result.line === null ? [] : [{
      path: result.path, rel: result.rel, line: result.line, text: result.text ?? "",
    }]),
    notice: workspaceSearchNotice(outcome),
  };
}

export async function loadWorkspaceFiles(root = getWorkspaceRoot(), query = "", signal?: AbortSignal): Promise<WorkspaceFilesOutcome> {
  if (!root) return { files: [], notice: "Open a folder to search files." };
  const outcome = await searchWorkspace({ root, query, mode: "files", maxResults: 200, signal });
  return {
    files: outcome.results.map(({ path, rel, name }) => ({ path, rel, name })),
    notice: workspaceSearchNotice(outcome),
  };
}
