import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
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
  subscribeLauncherCache,
  workspaceFilesCacheKey,
  type NoteEntry,
  type K8sContextEntry,
  type WorkspaceFileEntry,
  type GrepResult,
} from "./sources";
import type { DockerContainer } from "../docker/client";
import { bgKill, type BgJob } from "../jobs/client";
import type { Workflow } from "../workflows/store";
import { removeRecentNote } from "../notes/store";
import { toast } from "../toast";
import { getAllSessions, deleteSession } from "../ai/sessionStore";
import {
  BUILT_IN_WALLPAPERS,
  builtInWallpaperPath,
  listWallpapers,
  wallpaperName,
  applyWallpaper,
} from "../settings/wallpapers";
import { getPrefs } from "../settings/preferences";
import { loadAccounts as loadTotpAccounts } from "../totp/store";
import { generateCode as generateTotpCode } from "../totp/totp";
import { useClipHistory, deleteClip } from "../clipboard/store";
import { useBookmarks, addBookmark, removeBookmark, toggleBookmarkPin, type Bookmark } from "../bookmarks/store";
import { parseQuery, matchScopeTokens } from "./query";
import {
  searchCodebase,
  buildCodebaseIndex,
  getCodebaseIndex,
  getIndexedRoot,
  type SearchResult,
} from "../ai/codebaseSearch";
import { getWorkspaceRoot, useWorkspaceRoot } from "../workspace/store";
import { normalizeWorkspacePath, resolveWorkspacePath } from "../ai/workspaceScope";
import { explainCommandPrompt, looksLikeCommand } from "../ai/assist";
import { shq } from "../lib/shellQuote";

const copy = (text: string) => writeText(text);

/** Callbacks the launcher needs from the app shell. */
export type LauncherCtx = {
  openNote: (path: string, name: string) => void;
  pinNote: (path: string) => void;
  unpinNote: (path: string) => void;
  openFile: (path: string, name: string, remoteHost?: string) => void;
  /** Open a file and scroll to a specific 1-based line (used by grep hits). */
  openFileAtLine: (path: string, name: string, line: number, remoteHost?: string) => void;
  typeInTerminal: (text: string) => void | Promise<void>;
  terminalTargetLabel?: string;
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
  /** Switch to an AI chat session and show the AI view. */
  selectAiSession: (id: string) => void;
  /** Rewrite the launcher input, e.g. to apply a scope token. */
  setQuery: (value: string) => void;
  openFiles: { path: string; name: string; remoteHost?: string }[];
};

type DynamicState = {
  notes: NoteEntry[];
  containers: DockerContainer[];
  k8s: K8sContextEntry[];
  jobs: BgJob[];
  sshHosts: string[];
  wallpapers: string[];
  loaded: boolean;
};

const EMPTY: DynamicState = {
  notes: [],
  containers: [],
  k8s: [],
  jobs: [],
  sshHosts: [],
  wallpapers: [],
  loaded: false,
};

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Staging remains explicit even when entered through an item's action menu. */
function stageCommand(text: string, ctx: LauncherCtx) {
  return {
    primaryLabel: "Stage command",
    confirmation: {
      title: "Stage command",
      description: `Target: ${ctx.terminalTargetLabel || "Unavailable"}\n\n${text}\n\nStages this exact text without pressing Enter.`,
      confirmLabel: "Stage command",
    },
    run: () => ctx.typeInTerminal(text),
  };
}

function stageAction(text: string, ctx: LauncherCtx, hint: string) {
  return { ...stageCommand(text, ctx), label: "Stage command", hint };
}

/** Merges static app commands with live sources (notes, files, clipboard,
 *  bookmarks, docker, k8s, workflows, jobs, remotes, and ripgrep). Async
 *  sources are TTL-cached and refreshed while the palette is open. */
export function useLauncherItems(
  open: boolean,
  rawInput: string,
  commands: Command[],
  ctx: LauncherCtx,
): Command[] {
  const [dyn, setDyn] = useState<DynamicState>(EMPTY);
  const workspaceRoot = normalizeWorkspacePath(useWorkspaceRoot());
  const [workspaceFiles, setWorkspaceFiles] = useState<{ root: string; files: WorkspaceFileEntry[] }>({ root: "", files: [] });
  const [grepState, setGrepState] = useState<{ root: string; query: string; results: GrepResult[] }>({ root: "", query: "", results: [] });
  const [grepBusy, setGrepBusy] = useState(false);
  const [grepMissingTool, setGrepMissingTool] = useState(false);
  const [codeState, setCodeState] = useState<{ root: string; query: string; results: SearchResult[] }>({ root: "", query: "", results: [] });
  const [codeIndexing, setCodeIndexing] = useState(false);
  const [codeSnapshot, setCodeSnapshot] = useState<{ root: string; index: ReturnType<typeof getCodebaseIndex> }>({ root: "", index: null });

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

    const loaders: Record<string, () => Promise<unknown>> = {
      notes: () => loadNoteEntries().then((notes) => merge({ notes })),
      docker: () => loadDockerContainers().then((containers) => merge({ containers })),
      k8s: () => loadK8sContexts().then((k8s) => merge({ k8s })),
      jobs: () => loadRunningJobs().then((jobs) => merge({ jobs })),
      "ssh-hosts": () => loadSshHosts().then((sshHosts) => merge({ sshHosts })),
    };
    const reload = () => {
      const loads = Object.values(loaders).map((load) => load().catch(() => {}));
      void Promise.allSettled(loads).then(() => merge({ loaded: true }));
    };
    const unsubscribe = subscribeLauncherCache((key) => { void loaders[key]?.().catch(() => {}); });
    reload();
    void listWallpapers(getPrefs().background.dir).then((wallpapers) => merge({ wallpapers })).catch(() => {});
    const interval = setInterval(reload, 30_000);

    return () => {
      cancelled = true;
      unsubscribe();
      clearInterval(interval);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !workspaceRoot) return;
    let cancelled = false;
    const refresh = () => {
      void loadWorkspaceFiles(workspaceRoot).then((files) => {
        if (!cancelled) setWorkspaceFiles((previous) => previous.root === workspaceRoot && previous.files === files
          ? previous : { root: workspaceRoot, files });
      }).catch(() => {});
    };
    const unsubscribe = subscribeLauncherCache((key) => {
      if (key === workspaceFilesCacheKey(workspaceRoot)) refresh();
    });
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => { cancelled = true; unsubscribe(); clearInterval(interval); };
  }, [open, workspaceRoot]);

  // Live ripgrep search when the user scopes to "g".
  useEffect(() => {
    if (!open || scopedKind !== "grep" || !query.trim()) {
      // Reuse the existing array when it is already empty: a fresh [] is never
      // reference-equal, so it would re-run the item memo on every keystroke.
      setGrepState((state) => state.results.length ? { root: "", query: "", results: [] } : state);
      setGrepBusy(false);
      setGrepMissingTool(false);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      setGrepBusy(true);
      searchWorkspaceContents(query, 50, workspaceRoot)
        .then(({ results, missingTool }) => {
          if (ac.signal.aborted) return;
          setGrepState({ root: workspaceRoot, query, results });
          setGrepMissingTool(missingTool);
        })
        .catch(() => {})
        .finally(() => {
          if (!ac.signal.aborted) setGrepBusy(false);
        });
    }, 150);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [open, scopedKind, query, workspaceRoot]);

  /* Ranked code search over the AI index. Unlike "g:" (a single literal string
     through ripgrep) this splits the query into terms, drops stopwords and weights
     filename over content — so a phrase like "pod name parsing" ranks sensibly.
     It is keyword scoring, not embeddings: words that never appear in the code
     will not find it. */
  const codeActive = open && scopedKind === "code" && Boolean(query.trim());
  // Index lifetime is independent of the words being typed. Query changes
  // reuse the in-flight scan; changing roots/closing the scope cancels it.
  useEffect(() => {
    if (!codeActive || !workspaceRoot) {
      setCodeIndexing(false);
      setCodeSnapshot((snapshot) => snapshot.index ? { root: "", index: null } : snapshot);
      return;
    }
    if (getIndexedRoot() === workspaceRoot) {
      setCodeIndexing(false);
      setCodeSnapshot({ root: workspaceRoot, index: getCodebaseIndex() });
      return;
    }
    const ac = new AbortController();
    setCodeSnapshot((snapshot) => snapshot.index ? { root: "", index: null } : snapshot);
    setCodeIndexing(true);
    void buildCodebaseIndex(workspaceRoot, { signal: ac.signal }).then((index) => {
      if (!ac.signal.aborted) setCodeSnapshot({ root: workspaceRoot, index });
    }).catch(() => {}).finally(() => {
      if (!ac.signal.aborted) setCodeIndexing(false);
    });
    return () => ac.abort();
  }, [codeActive, workspaceRoot]);

  useEffect(() => {
    if (!codeActive || codeSnapshot.root !== workspaceRoot || !codeSnapshot.index) {
      // Preserve the empty state identity on ordinary, non-code keystrokes.
      setCodeState((state) => state.results.length ? { root: "", query: "", results: [] } : state);
      return;
    }
    const t = setTimeout(() => {
      setCodeState({ root: workspaceRoot, query, results: searchCodebase(query, 30, codeSnapshot.index!) });
    }, 150);
    return () => clearTimeout(t);
  }, [codeActive, query, workspaceRoot, codeSnapshot]);

  const openPaths = useMemo(() => new Set(ctx.openFiles.filter((f) => !f.remoteHost).map((f) => f.path)), [ctx.openFiles]);
  const clips = useClipHistory();
  const bookmarks = useBookmarks();

  /* The base list is every item from every source — on a large workspace that is
     thousands of objects with fresh closures. It must NOT depend on the query
     text, or each keystroke rebuilds all of it and cmdk then re-scores and
     re-sorts the lot, which makes typing visibly lag. Query-dependent rows are
     appended in a second, cheap memo below. */
  const base = useMemo(() => {
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
        detail: n.path,
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

    /* Wallpapers in the configured folder.
       Named rows rather than only next/previous commands: with twenty images,
       cycling to the one you want means pressing a key nineteen times. */
    for (const path of dyn.wallpapers) {
      const name = wallpaperName(path);
      const current = path === getPrefs().background.path;
      items.push({
        id: `wallpaper:${path}`,
        kind: "wallpaper",
        label: name,
        detail: path,
        hint: current ? "current" : undefined,
        keywords: "wallpaper background image",
        group: "Wallpaper",
        run: () => applyWallpaper(path),
        actions: [{ label: "Copy path", run: () => copy(path) }],
      });
    }

    /* Built-in wallpapers are available even before a local folder is set.
       The launcher is a useful fast path, while Appearance keeps the visual
       gallery for browsing them. */
    for (const wallpaper of BUILT_IN_WALLPAPERS) {
      const path = builtInWallpaperPath(wallpaper.id);
      const current = path === getPrefs().background.path;
      items.push({
        id: `wallpaper:${path}`,
        kind: "wallpaper",
        label: wallpaper.name,
        detail: wallpaper.description,
        hint: current ? "current" : "built-in",
        keywords: `wallpaper background image built-in ${wallpaper.name} ${wallpaper.description}`,
        group: "Wallpaper",
        run: () => applyWallpaper(path),
      });
    }

    /* AI chat sessions.
       These were reachable only from a title-bar dropdown, which is fine at
       three sessions and useless at thirty — a list you cannot search. Rows
       here are searchable by name and carry the same delete the panel had. */
    for (const sess of getAllSessions()) {
      if (sess.archived) continue;
      const count = sess.messages.length;
      items.push({
        id: `session:${sess.id}`,
        kind: "session",
        label: sess.name,
        detail: `Chat · ${sess.source} · ${count} messages`,
        hint: count ? `${count} message${count === 1 ? "" : "s"}` : "empty",
        keywords: `chat session ai ${sess.source}`,
        group: "Chats",
        run: () => ctx.selectAiSession(sess.id),
        actions: [
          { label: "Copy name", run: () => copy(sess.name) },
          {
            label: "Delete chat",
            confirmation: { title: "Delete chat?", description: `Delete “${sess.name}” and its ${count} messages? This cannot be undone.`, confirmLabel: "Delete chat" },
            run: () => deleteSession(sess.id),
          },
        ],
      });
    }

    /* 2FA codes.
       The code is generated inside run(), not here. Generating it for the row
       would print a value that goes stale within 30 seconds while the palette
       sits open, and refreshing every second would re-run a memo over every
       launcher item once a second — the same shape as the perf regression this
       list already had once. So the row identifies the account and Enter
       produces a code that is correct at the instant it is copied. */
    for (const acc of loadTotpAccounts()) {
      const name = acc.issuer ? `${acc.issuer} — ${acc.label}` : acc.label;
      const copyCode = async () => {
        const gen = generateTotpCode(acc);
        if (!gen) {
          toast({ title: "Could not generate code", message: name, variant: "error" });
          return;
        }
        await copy(gen.code);
        toast({
          title: "Code copied",
          message: `${name} · expires in ${gen.remaining}s`,
          variant: "success",
          duration: 2500,
        });
      };
      items.push({
        id: `totp:${acc.id}`,
        kind: "totp",
        label: name,
        detail: `2FA · ${name}`,
        primaryLabel: "Copy code",
        hint: "copy code",
        keywords: [acc.issuer, acc.label, "2fa", "otp", "totp", "authenticator"]
          .filter(Boolean)
          .join(" "),
        group: "2FA",
        run: copyCode,
        actions: [{ label: "Copy code", run: copyCode }],
      });
    }

    // Open editor files first, then workspace files
    for (const f of ctx.openFiles) {
      items.push({
        id: `file-open:${f.remoteHost ? `${f.remoteHost}:` : ""}${f.path}`,
        kind: "file",
        label: f.name,
        detail: f.remoteHost ? `${f.remoteHost}:${f.path}` : f.path,
        hint: "open",
        keywords: f.path,
        group: "Files",
        run: () => ctx.openFile(f.path, f.name, f.remoteHost),
        secondary: {
          label: "copy path",
          run: () => copy(f.path),
        },
      });
    }
    for (const f of workspaceFiles.root === workspaceRoot ? workspaceFiles.files : []) {
      if (openPaths.has(f.path)) continue;
      items.push({
        id: `file:${f.path}`,
        kind: "file",
        label: f.rel,
        detail: f.path,
        keywords: f.name,
        group: "Files",
        run: () => ctx.openFile(f.path, f.name),
        secondary: {
          label: "copy path",
          run: () => copy(f.path),
        },
        actions: [
          { label: "Copy filename", run: () => copy(f.name) },
          stageAction(shq(f.path), ctx, "Insert quoted path"),
          stageAction(`cd ${shq(f.path.replace(/\/[^/]*$/, ""))}`, ctx, "Change directory"),
        ],
      });
    }

    // Clipboard history
    for (const c of clips) {
      const copyOnly = c.text.length > 2_000 || /[\x00-\x1f\x7f\u2028\u2029]/.test(c.text);
      items.push({
        id: `clip:${c.id}`,
        kind: "clipboard",
        label: trunc(c.text, 80),
        detail: c.text,
        hint: copyOnly ? "copy only" : "clipboard",
        keywords: c.text,
        group: "Clipboard",
        ...(copyOnly ? { primaryLabel: "Copy text", run: () => copy(c.text) } : stageCommand(c.text, ctx)),
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

    // Workflows
    for (const wf of loadWorkflowEntries()) {
      items.push({
        id: `workflow:${wf.id}`,
        kind: "workflow",
        label: wf.name,
        detail: wf.description || `Workflow · ${wf.steps.length} steps`,
        hint: `${wf.steps.length} step${wf.steps.length === 1 ? "" : "s"}`,
        keywords: wf.description ?? "",
        group: "Workflows",
        run: () => ctx.runWorkflow(wf),
        secondary: { label: "edit", run: () => ctx.openWorkflows() },
        actions: [
          {
            label: "Copy step templates",
            run: () =>
              copy(wf.steps.join("\n")),
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
        detail: `${j.command}${j.cwd ? ` · ${j.cwd}` : ""}`,
        hint: "running",
        keywords: j.cwd ?? "",
        group: "Jobs",
        run: () => ctx.openJobs(),
        secondary: { label: "copy cmd", run: () => copy(j.command) },
        actions: [
          {
            label: "Kill job",
            confirmation: { title: "Kill running job?", description: `Stop this running job?\n\n${j.command}\n${j.cwd ?? ""}`, confirmLabel: "Kill job" },
            run: () => bgKill(j.handle),
          },
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
        detail: `Docker · ${c.image} · ${c.id}`,
        hint: c.state === "running" ? "running" : c.state,
        keywords: `${c.image} ${c.status}`,
        group: "Docker",
        run: () => ctx.openDocker(),
        secondary: {
          label: "copy name",
          run: () => copy(c.name),
        },
        actions: [
          stageAction(`docker logs -f ${shq(c.name)}`, ctx, "Tail logs"),
          stageAction(`docker exec -it ${shq(c.name)} sh`, ctx, "Shell into container"),
          stageAction(`docker restart ${shq(c.name)}`, ctx, "Restart"),
        ],
      });
    }

    // Kubernetes contexts
    for (const k of dyn.k8s) {
      items.push({
        id: `k8s:${k.name}`,
        kind: "k8s",
        label: k.name,
        detail: `Kubernetes context · ${k.name}`,
        hint: k.current ? "App default · current" : "App default",
        group: "Kubernetes",
        run: () => ctx.switchK8sContext(k.name),
        secondary: { label: "open", run: () => ctx.openK8s() },
        actions: [
          stageAction(`kubectl config use-context ${shq(k.name)}`, ctx, "Switch context"),
          { label: "Copy context name", run: () => copy(k.name) },
        ],
      });
    }

    // SSH remotes
    for (const h of dyn.sshHosts) {
      items.push({
        id: `remote:${h}`,
        kind: "remote",
        label: h,
        detail: `SSH host · ${h}`,
        keywords: "ssh remote host",
        group: "Remotes",
        run: () => ctx.connectRemote(h),
        actions: [
          stageAction(`ssh ${shq(h)}`, ctx, "Connect to host"),
          { label: "Copy host", run: () => copy(h) },
        ],
      });
    }

    return items;
  }, [commands, ctx, dyn, openPaths, clips, bookmarks, workspaceRoot, workspaceFiles]);

  /* Cheap per-keystroke layer: a handful of rows appended to a stable base. */
  return useMemo(() => {
    const extra: Command[] = [];

    if (scopedKind === "code") {
      const results = codeState.root === workspaceRoot && codeState.query === query ? codeState.results : [];
      for (const result of results) {
        // The index stores relative paths. Resolve against the root captured
        // with this result, never whichever workspace is active on invocation.
        const path = resolveWorkspacePath(result.path, codeState.root);
        if (!path) continue;
        const name = result.path.split("/").pop() ?? result.path;
        const first = result.matches[0];
        extra.push({
          id: `code:${path}`, kind: "code", label: result.path,
          detail: `${path}${first ? `:${first.line} · ${first.text}` : ""}`,
          hint: first ? `line ${first.line}` : undefined,
          keywords: result.snippet, group: "Code", alwaysShow: true, searchScore: result.score,
          run: () => first ? ctx.openFileAtLine(path, name, first.line) : ctx.openFile(path, name),
          secondary: { label: "copy path", run: () => copy(path) },
        });
      }
      if (codeIndexing || (query.trim() && extra.length === 0)) extra.push({
        id: codeIndexing ? "code:indexing" : "code:none", kind: "code", group: "Code", status: true,
        label: codeIndexing ? "Building codebase index…" : workspaceRoot ? "No indexed matches" : "Open a folder to search code",
        run: () => {},
      });
      return extra.length ? [...base, ...extra] : base;
    }

    if (scopedKind === "grep") {
      const results = grepState.root === workspaceRoot && grepState.query === query ? grepState.results : [];
      for (const result of results) {
        const name = result.rel.split("/").pop() ?? result.rel;
        extra.push({
          id: `grep:${result.path}:${result.line}`, kind: "grep", label: `${result.rel}:${result.line}`,
          detail: `${result.path}:${result.line} · ${result.text}`,
          hint: `line ${result.line}`, keywords: result.text, group: "Files", alwaysShow: true,
          run: () => ctx.openFileAtLine(result.path, name, result.line),
          secondary: { label: "copy path", run: () => copy(result.path) },
          actions: [
            { label: "Open file (no jump)", run: () => ctx.openFile(result.path, name) },
            { label: "Copy file:line", run: () => copy(`${result.path}:${result.line}`) },
            { label: "Copy matching line", run: () => copy(result.text) },
          ],
        });
      }
      if (grepBusy || grepMissingTool) extra.push({
        id: grepBusy ? "grep:searching" : "grep:no-rg", kind: "grep", group: "Files", status: true,
        label: grepBusy ? "Searching…" : "ripgrep not found — install rg for content search", run: () => {},
      });
      return extra.length ? [...base, ...extra] : base;
    }
    if (scopedKind) return base;

    /* Typing a source name offers the scope as a row. The footer legend hides as
       soon as you type, so this is how the "x:" syntax stays discoverable at the
       moment it is relevant. keepOpen rewrites the input instead of dismissing. */
    for (const { token, kind } of matchScopeTokens(query)) {
      extra.push({
        id: `scope:${token}`,
        kind,
        label: `Search ${token} only`,
        hint: `${token}:`,
        group: "Scopes",
        alwaysShow: true,
        keepOpen: true,
        run: () => ctx.setQuery(`${token}: `),
      });
    }

    /* Pre-flight explanation. explainError is a post-mortem; this reads an
       unfamiliar command BEFORE it runs, and asks whether it is destructive —
       which is the part worth knowing for the commands you would actually ask
       about. Only offered when the query parses as a command, so prose keeps the
       plain Ask AI row instead. */
    if (getPrefs().aiEnabled && looksLikeCommand(query)) {
      const cmd = query.trim();
      extra.push({
        id: "ai:explain-command",
        kind: "ai",
        label: `Explain command “${trunc(cmd, 40)}”`,
        hint: "before running",
        group: "Ask AI",
        alwaysShow: true,
        run: () => ctx.askAi(explainCommandPrompt(cmd, getWorkspaceRoot() || "")),
      });
    }

    // Last resort: never dead-end on a query. alwaysShow so cmdk's fuzzy filter
    // can't score it away, since its label never matches the query.
    if (getPrefs().aiEnabled && query.trim()) {
      extra.push({
        id: "ai:ask",
        kind: "ai",
        label: `Ask AI about “${trunc(query.trim(), 48)}”`,
        group: "Ask AI",
        alwaysShow: true,
        run: () => ctx.askAi(query.trim()),
      });
    }

    return extra.length ? [...base, ...extra] : base;
  }, [base, scopedKind, query, ctx, workspaceRoot, codeState, codeIndexing, grepState, grepBusy, grepMissingTool]);
}

function bookmarkToCommand(b: Bookmark, ctx: LauncherCtx): Command {
  const target = b.path ?? b.command ?? "";
  const base = {
    id: `bookmark:${b.id}`,
    kind: "bookmark" as LauncherKind,
    label: b.label,
    detail: target,
    keywords: `${b.path ?? ""} ${b.command ?? ""}`,
    group: "Bookmarks",
    actions: [
      { label: "Copy target", run: () => copy(target) },
      { label: b.pinned ? "Unpin" : "Pin", run: () => void toggleBookmarkPin(b.id) },
      {
        label: "Remove bookmark",
        run: () => {
          if (removeBookmark(b.id)) toast({ title: "Bookmark removed", variant: "success" });
        },
      },
      { label: "Open bookmarks panel", run: () => ctx.openBookmarks() },
    ],
  };
  if (b.type === "directory" && b.path) {
    return {
      ...base,
      hint: "dir",
      ...stageCommand(`cd ${shq(b.path)}`, ctx),
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
    ...stageCommand(b.command ?? "", ctx),
    secondary: { label: "copy", run: () => copy(b.command ?? "") },
  };
}
