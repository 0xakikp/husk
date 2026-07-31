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

/* Async data loaders for the launcher, with small TTL caches so opening the
   palette doesn't re-spawn CLI calls on every keystroke. */

type CacheEntry<T> = { at: number; data: T };
const cache = new Map<string, CacheEntry<unknown>>();

async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function invalidateLauncherCache() {
  cache.clear();
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

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

async function runShell(program: string, args: string[], cwd: string): Promise<string> {
  const out = await invoke<ShellOutput>("shell_run_command", {
    program,
    args,
    cwd,
    timeout_secs: 10,
  });
  if (out.exit_code !== 0) throw new Error(out.stderr || "failed");
  return out.stdout;
}

export type WorkspaceFileEntry = { path: string; rel: string; name: string };

export type GrepResult = { path: string; rel: string; line: number; text: string };

export async function searchWorkspaceContents(
  query: string,
  maxResults = 50,
): Promise<GrepResult[]> {
  const root = getWorkspaceRoot();
  if (!root || !query.trim()) return [];
  const cacheKey = `grep:${query.trim().toLowerCase()}`;
  return cached(cacheKey, 15_000, async () => {
    try {
      const out = await runShell(
        "rg",
        [
          "-n",
          "-i",
          // Fixed-string, not regex: launcher queries routinely contain ( [ { * +
          // and rg would abort with a parse error that we'd silently swallow.
          "-F",
          "--max-count",
          "1",
          "--max-columns",
          "200",
          "--glob",
          "!node_modules",
          "--glob",
          "!.git",
          "--glob",
          "!dist",
          "--glob",
          "!target",
          "--no-heading",
          "-e",
          query,
          ".",
        ],
        root,
      );
      const results: GrepResult[] = [];
      for (const line of out.split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        const file = line.slice(0, idx);
        const rest = line.slice(idx + 1);
        const lnIdx = rest.indexOf(":");
        if (lnIdx === -1) continue;
        const ln = parseInt(rest.slice(0, lnIdx), 10);
        if (!Number.isFinite(ln)) continue;
        const text = rest.slice(lnIdx + 1).trim();
        const rel = file.replace(/^\.\//, "");
        results.push({
          path: `${root.replace(/\/$/, "")}/${rel}`,
          rel,
          line: ln,
          text,
        });
        if (results.length >= maxResults) break;
      }
      return results;
    } catch {
      return [];
    }
  });
}

export async function loadWorkspaceFiles(): Promise<WorkspaceFileEntry[]> {
  return cached("ws-files", 60_000, async () => {
    const root = getWorkspaceRoot();
    if (!root) return [];
    let lines: string[] = [];
    // Prefer fd (fast, respects .gitignore); fall back to git ls-files.
    try {
      const out = await runShell(
        "fd",
        ["--type", "f", "--hidden", "--exclude", ".git", "--max-results", "3000", "."],
        root,
      );
      lines = out.split("\n");
    } catch {
      try {
        const out = await runShell("git", ["ls-files"], root);
        lines = out.split("\n");
      } catch {
        return [];
      }
    }
    const out: WorkspaceFileEntry[] = [];
    for (const raw of lines) {
      const rel = raw.trim().replace(/^\.\//, "");
      if (!rel) continue;
      out.push({
        path: `${root.replace(/\/$/, "")}/${rel}`,
        rel,
        name: rel.split("/").pop() ?? rel,
      });
      if (out.length >= 3000) break;
    }
    return out;
  });
}
