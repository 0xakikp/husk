import { useEffect, useMemo, useState } from "react";
import type { Command, LauncherKind } from "./CommandPalette";
import {
  loadNoteEntries,
  loadDockerContainers,
  loadK8sContexts,
  loadWorkflowEntries,
  loadRunningJobs,
  loadSshHosts,
  loadWorkspaceFiles,
  searchWorkspaceContents,
  type NoteEntry,
  type K8sContextEntry,
  type WorkspaceFileEntry,
  type GrepResult,
} from "./sources";
import type { DockerContainer } from "../docker/client";
import { bgKill, type BgJob } from "../jobs/client";
import type { Workflow } from "../workflows/store";
import { composeCommand } from "../workflows/params";
import { removeRecentNote } from "../notes/store";
import { useClipHistory, deleteClip } from "../clipboard/store";
import { useBookmarks, addBookmark, toggleBookmarkPin, type Bookmark } from "../bookmarks/store";
import { parseQuery } from "./CommandPalette";

const copy = (text: string) => void navigator.clipboard.writeText(text);

/** Callbacks the launcher needs from the app shell. */
export type LauncherCtx = {
  openNote: (path: string, name: string) => void;
  pinNote: (path: string) => void;
  unpinNote: (path: string) => void;
  openFile: (path: string, name: string) => void;
  /** Open a file and scroll to a specific 1-based line (used by grep hits). */
  openFileAtLine: (path: string, name: string, line: number) => void;
  typeInTerminal: (text: string) => void;
  openDocker: () => void;
  openK8s: () => void;
  switchK8sContext: (name: string) => void;
  runWorkflow: (wf: Workflow) => void;
  openWorkflows: () => void;
  openJobs: () => void;
  connectRemote: (host: string) => void;
  openBookmarks: () => void;
  /** Hand the raw query to the AI bubble so the launcher never dead-ends. */
  askAi: (query: string) => void;
  openFiles: { path: string; name: string }[];
};

type DynamicState = {
  notes: NoteEntry[];
  containers: DockerContainer[];
  k8s: K8sContextEntry[];
  jobs: BgJob[];
  sshHosts: string[];
  wsFiles: WorkspaceFileEntry[];
  loaded: boolean;
};

const EMPTY: DynamicState = {
  notes: [],
  containers: [],
  k8s: [],
  jobs: [],
  sshHosts: [],
  wsFiles: [],
  loaded: false,
};

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Merges static app commands with live sources (notes, files, clipboard,
 *  bookmarks, docker, k8s, workflows, jobs, remotes, and ripgrep). Async
 *  sources load once per palette open and are TTL-cached in sources.ts. */
export function useLauncherItems(
  open: boolean,
  rawInput: string,
  commands: Command[],
  ctx: LauncherCtx,
): Command[] {
  const [dyn, setDyn] = useState<DynamicState>(EMPTY);
  const [grepResults, setGrepResults] = useState<GrepResult[]>([]);
  const [grepBusy, setGrepBusy] = useState(false);
  const [grepMissingTool, setGrepMissingTool] = useState(false);

  const { kind: scopedKind, query } = useMemo(() => parseQuery(rawInput), [rawInput]);

  /* Each source lands on its own. Notes and files are local and near-instant;
     docker, k8s and the ssh-config read shell out and can take seconds. A
     Promise.all barrier made the fast ones wait for the slowest, so the palette
     appeared to hang before showing anything. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const merge = (patch: Partial<DynamicState>) => {
      if (!cancelled) setDyn((d) => ({ ...d, ...patch }));
    };

    const loads: Promise<unknown>[] = [
      loadNoteEntries().then((notes) => merge({ notes })),
      loadWorkspaceFiles().then((wsFiles) => merge({ wsFiles })),
      loadDockerContainers().then((containers) => merge({ containers })),
      loadK8sContexts().then((k8s) => merge({ k8s })),
      loadRunningJobs().then((jobs) => merge({ jobs })),
      loadSshHosts().then((sshHosts) => merge({ sshHosts })),
    ].map((p) => p.catch(() => {}));

    void Promise.allSettled(loads).then(() => merge({ loaded: true }));

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Live ripgrep search when the user scopes to "g".
  useEffect(() => {
    if (!open || scopedKind !== "grep" || !query.trim()) {
      setGrepResults([]);
      setGrepBusy(false);
      setGrepMissingTool(false);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setGrepBusy(true);
      searchWorkspaceContents(query, 50)
        .then(({ results, missingTool }) => {
          if (ac.signal.aborted) return;
          setGrepResults(results);
          setGrepMissingTool(missingTool);
        })
        .finally(() => {
          if (!ac.signal.aborted) setGrepBusy(false);
        });
    }, 150);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [open, scopedKind, query]);

  const openPaths = useMemo(() => new Set(ctx.openFiles.map((f) => f.path)), [ctx.openFiles]);
  const clips = useClipHistory();
  const bookmarks = useBookmarks();

  return useMemo(() => {
    const items: Command[] = [];

    // Commands (static)
    for (const c of commands) {
      items.push({ ...c, kind: c.kind ?? ("command" as LauncherKind) });
    }

    // Notes
    for (const n of dyn.notes) {
      items.push({
        id: `note:${n.path}`,
        kind: "note",
        label: n.name,
        hint: n.pinned ? "pinned" : undefined,
        keywords: n.rel,
        group: "Notes",
        run: () => ctx.openNote(n.path, n.name),
        secondary: {
          label: n.pinned ? "unpin" : "pin",
          run: () => (n.pinned ? ctx.unpinNote(n.path) : ctx.pinNote(n.path)),
        },
        actions: [
          { label: "Copy path", run: () => copy(n.path) },
          { label: "Copy filename", run: () => copy(n.name) },
          { label: "Remove from recents", run: () => removeRecentNote(n.path) },
        ],
      });
    }

    // Open editor files first, then workspace files
    for (const f of ctx.openFiles) {
      items.push({
        id: `file-open:${f.path}`,
        kind: "file",
        label: f.name,
        hint: "open",
        keywords: f.path,
        group: "Files",
        run: () => ctx.openFile(f.path, f.name),
        secondary: {
          label: "copy path",
          run: () => void navigator.clipboard.writeText(f.path),
        },
      });
    }
    for (const f of dyn.wsFiles) {
      if (openPaths.has(f.path)) continue;
      items.push({
        id: `file:${f.path}`,
        kind: "file",
        label: f.rel,
        keywords: f.name,
        group: "Files",
        run: () => ctx.openFile(f.path, f.name),
        secondary: {
          label: "copy path",
          run: () => void navigator.clipboard.writeText(f.path),
        },
        actions: [
          { label: "Copy filename", run: () => void navigator.clipboard.writeText(f.name) },
          { label: "Type path in terminal", run: () => ctx.typeInTerminal(f.path) },
          {
            label: "cd to containing folder",
            run: () => ctx.typeInTerminal(`cd "${f.path.replace(/\/[^/]*$/, "")}"`),
          },
        ],
      });
    }

    // Clipboard history
    for (const c of clips) {
      items.push({
        id: `clip:${c.id}`,
        kind: "clipboard",
        label: trunc(c.text, 80),
        hint: "clipboard",
        keywords: c.text,
        group: "Clipboard",
        run: () => ctx.typeInTerminal(c.text),
        secondary: {
          label: "copy",
          run: () => copy(c.text),
        },
        actions: [
          {
            label: "Save as bookmark",
            run: () =>
              void addBookmark({ type: "command", label: trunc(c.text, 40), command: c.text }),
          },
          { label: "Remove from history", run: () => deleteClip(c.id) },
        ],
      });
    }

    // Bookmarks
    for (const b of bookmarks) {
      items.push(bookmarkToCommand(b, ctx));
    }

    // Ripgrep results (only shown in the grep scope)
    if (scopedKind === "grep") {
      for (const r of grepResults) {
        const name = r.rel.split("/").pop() ?? r.rel;
        items.push({
          id: `grep:${r.path}:${r.line}`,
          kind: "grep",
          label: `${r.rel}:${r.line}`,
          hint: `line ${r.line}`,
          keywords: r.text,
          group: "Files",
          run: () => ctx.openFileAtLine(r.path, name, r.line),
          secondary: {
            label: "copy path",
            run: () => copy(r.path),
          },
          actions: [
            { label: "Open file (no jump)", run: () => ctx.openFile(r.path, name) },
            { label: "Copy file:line", run: () => copy(`${r.rel}:${r.line}`) },
            { label: "Copy matching line", run: () => copy(r.text) },
          ],
        });
      }
      if (grepBusy) {
        items.push({
          id: "grep:searching",
          kind: "grep",
          label: "Searching…",
          group: "Files",
          status: true,
          run: () => {},
        });
      } else if (grepMissingTool) {
        items.push({
          id: "grep:no-rg",
          kind: "grep",
          label: "ripgrep not found — install rg for content search",
          group: "Files",
          status: true,
          run: () => {},
        });
      }
    }

    // Workflows
    for (const wf of loadWorkflowEntries()) {
      items.push({
        id: `workflow:${wf.id}`,
        kind: "workflow",
        label: wf.name,
        hint: `${wf.steps.length} step${wf.steps.length === 1 ? "" : "s"}`,
        keywords: wf.description ?? "",
        group: "Workflows",
        run: () => ctx.runWorkflow(wf),
        secondary: { label: "edit", run: () => ctx.openWorkflows() },
        actions: [
          {
            label: "Copy composed command",
            run: () =>
              copy(composeCommand(wf.steps, {}, { stopOnError: wf.stopOnError !== false })),
          },
          { label: "Copy name", run: () => copy(wf.name) },
        ],
      });
    }

    // Running jobs
    for (const j of dyn.jobs) {
      items.push({
        id: `job:${j.handle}`,
        kind: "job",
        label: trunc(j.command, 60),
        hint: "running",
        keywords: j.cwd ?? "",
        group: "Jobs",
        run: () => ctx.openJobs(),
        secondary: { label: "copy cmd", run: () => copy(j.command) },
        actions: [
          { label: "Kill job", run: () => void bgKill(j.handle).catch(() => {}) },
          { label: "Copy working directory", run: () => copy(j.cwd ?? "") },
        ],
      });
    }

    // Docker containers
    for (const c of dyn.containers) {
      items.push({
        id: `docker:${c.id}`,
        kind: "container",
        label: c.name,
        hint: c.state === "running" ? "running" : c.state,
        keywords: `${c.image} ${c.status}`,
        group: "Docker",
        run: () => ctx.openDocker(),
        secondary: {
          label: "copy name",
          run: () => void navigator.clipboard.writeText(c.name),
        },
        actions: [
          { label: "Tail logs", run: () => ctx.typeInTerminal(`docker logs -f ${c.name}`) },
          { label: "Shell into container", run: () => ctx.typeInTerminal(`docker exec -it ${c.name} sh`) },
          { label: "Restart", run: () => ctx.typeInTerminal(`docker restart ${c.name}`) },
        ],
      });
    }

    // Kubernetes contexts
    for (const k of dyn.k8s) {
      items.push({
        id: `k8s:${k.name}`,
        kind: "k8s",
        label: k.name,
        hint: k.current ? "current" : undefined,
        group: "Kubernetes",
        run: () => ctx.switchK8sContext(k.name),
        secondary: { label: "open", run: () => ctx.openK8s() },
        actions: [
          {
            label: "Type use-context command",
            run: () => ctx.typeInTerminal(`kubectl config use-context ${k.name}`),
          },
          { label: "Copy context name", run: () => void navigator.clipboard.writeText(k.name) },
        ],
      });
    }

    // SSH remotes
    for (const h of dyn.sshHosts) {
      items.push({
        id: `remote:${h}`,
        kind: "remote",
        label: h,
        keywords: "ssh remote host",
        group: "Remotes",
        run: () => ctx.connectRemote(h),
        actions: [
          { label: "Type ssh command", run: () => ctx.typeInTerminal(`ssh ${h}`) },
          { label: "Copy host", run: () => void navigator.clipboard.writeText(h) },
        ],
      });
    }

    // Last resort: never dead-end on a query. Rendered as a status row so cmdk's
    // fuzzy filter can't score it away, since its label never matches the query.
    if (!scopedKind && query.trim()) {
      items.push({
        id: "ai:ask",
        kind: "ai",
        label: `Ask AI about “${trunc(query.trim(), 48)}”`,
        group: "Ask AI",
        alwaysShow: true,
        run: () => ctx.askAi(query.trim()),
      });
    }

    return items;
  }, [commands, ctx, dyn, openPaths, clips, bookmarks, scopedKind, query, grepResults, grepBusy, grepMissingTool]);
}

function bookmarkToCommand(b: Bookmark, ctx: LauncherCtx): Command {
  const target = b.path ?? b.command ?? "";
  const base = {
    id: `bookmark:${b.id}`,
    kind: "bookmark" as LauncherKind,
    label: b.label,
    keywords: `${b.path ?? ""} ${b.command ?? ""}`,
    group: "Bookmarks",
    actions: [
      { label: "Copy target", run: () => copy(target) },
      { label: b.pinned ? "Unpin" : "Pin", run: () => void toggleBookmarkPin(b.id) },
      { label: "Open bookmarks panel", run: () => ctx.openBookmarks() },
    ],
  };
  if (b.type === "directory" && b.path) {
    return {
      ...base,
      hint: "dir",
      run: () => ctx.typeInTerminal(`cd "${b.path}"`),
      secondary: { label: "copy path", run: () => copy(b.path!) },
    };
  }
  if (b.type === "file" && b.path) {
    return {
      ...base,
      hint: "file",
      run: () => ctx.openFile(b.path!, b.label),
      secondary: { label: "copy path", run: () => copy(b.path!) },
    };
  }
  return {
    ...base,
    hint: "cmd",
    run: () => ctx.typeInTerminal(b.command ?? ""),
    secondary: { label: "copy", run: () => copy(b.command ?? "") },
  };
}
