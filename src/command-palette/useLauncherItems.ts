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
import type { BgJob } from "../jobs/client";
import type { Workflow } from "../workflows/store";
import { useClipHistory } from "../clipboard/store";
import { useBookmarks, type Bookmark } from "../bookmarks/store";
import { parseQuery } from "./CommandPalette";

/** Callbacks the launcher needs from the app shell. */
export type LauncherCtx = {
  openNote: (path: string, name: string) => void;
  pinNote: (path: string) => void;
  unpinNote: (path: string) => void;
  openFile: (path: string, name: string) => void;
  typeInTerminal: (text: string) => void;
  openDocker: () => void;
  openK8s: () => void;
  switchK8sContext: (name: string) => void;
  runWorkflow: (wf: Workflow) => void;
  openWorkflows: () => void;
  openJobs: () => void;
  connectRemote: (host: string) => void;
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

  const { kind: scopedKind, query } = useMemo(() => parseQuery(rawInput), [rawInput]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setDyn((d) => ({ ...d, loaded: false }));
    Promise.all([
      loadNoteEntries(),
      loadDockerContainers(),
      loadK8sContexts(),
      loadRunningJobs(),
      loadSshHosts(),
      loadWorkspaceFiles(),
    ]).then(([notes, containers, k8s, jobs, sshHosts, wsFiles]) => {
      if (cancelled) return;
      setDyn({ notes, containers, k8s, jobs, sshHosts, wsFiles, loaded: true });
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Live ripgrep search when the user scopes to "g".
  useEffect(() => {
    if (!open || scopedKind !== "grep" || !query.trim()) {
      setGrepResults([]);
      setGrepBusy(false);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setGrepBusy(true);
      searchWorkspaceContents(query, 50)
        .then((results) => {
          if (ac.signal.aborted) return;
          setGrepResults(results);
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
          run: () => void navigator.clipboard.writeText(c.text),
        },
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
          run: () => ctx.openFile(r.path, name),
          secondary: {
            label: "copy path",
            run: () => void navigator.clipboard.writeText(r.path),
          },
        });
      }
      if (grepBusy) {
        items.push({
          id: "grep:searching",
          kind: "command",
          label: "Searching…",
          group: "Files",
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
      });
    }

    return items;
  }, [commands, ctx, dyn, openPaths, clips, bookmarks, scopedKind, grepResults, grepBusy]);
}

function bookmarkToCommand(b: Bookmark, ctx: LauncherCtx): Command {
  const base = {
    id: `bookmark:${b.id}`,
    kind: "bookmark" as LauncherKind,
    label: b.label,
    keywords: `${b.path ?? ""} ${b.command ?? ""}`,
    group: "Bookmarks",
  };
  if (b.type === "directory" && b.path) {
    return {
      ...base,
      hint: "dir",
      run: () => ctx.typeInTerminal(`cd "${b.path}"`),
      secondary: { label: "copy path", run: () => void navigator.clipboard.writeText(b.path!) },
    };
  }
  if (b.type === "file" && b.path) {
    return {
      ...base,
      hint: "file",
      run: () => ctx.openFile(b.path!, b.label),
      secondary: { label: "copy path", run: () => void navigator.clipboard.writeText(b.path!) },
    };
  }
  return {
    ...base,
    hint: "cmd",
    run: () => ctx.typeInTerminal(b.command ?? ""),
    secondary: { label: "copy", run: () => void navigator.clipboard.writeText(b.command ?? "") },
  };
}
