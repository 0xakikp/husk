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
  type NoteEntry,
  type K8sContextEntry,
  type WorkspaceFileEntry,
} from "./sources";
import type { DockerContainer } from "../docker/client";
import type { BgJob } from "../jobs/client";
import type { Workflow } from "../workflows/store";

/** Callbacks the launcher needs from the app shell. */
export type LauncherCtx = {
  openNote: (path: string, name: string) => void;
  pinNote: (path: string) => void;
  unpinNote: (path: string) => void;
  openFile: (path: string, name: string) => void;
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

/** Merges static app commands with live sources (notes, files, docker, k8s,
 *  workflows, jobs, remotes). Async sources load once per palette open and
 *  are TTL-cached in sources.ts. */
export function useLauncherItems(
  open: boolean,
  commands: Command[],
  ctx: LauncherCtx,
): Command[] {
  const [dyn, setDyn] = useState<DynamicState>(EMPTY);

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

  const openPaths = useMemo(() => new Set(ctx.openFiles.map((f) => f.path)), [ctx.openFiles]);

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
  }, [commands, ctx, dyn, openPaths]);
}
