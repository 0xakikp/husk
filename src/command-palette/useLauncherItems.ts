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
import { toast } from "../toast";
import { getAllSessions, deleteSession } from "../ai/sessionStore";
import { listWallpapers, wallpaperName, applyWallpaper } from "../settings/wallpapers";
import { listScripts, runCommandFor, type ScriptFile } from "../scripts/scripts";
import { getPrefs } from "../settings/preferences";
import { loadAccounts as loadTotpAccounts } from "../totp/store";
import { generateCode as generateTotpCode } from "../totp/totp";
import { useClipHistory, deleteClip } from "../clipboard/store";
import { useBookmarks, addBookmark, toggleBookmarkPin, type Bookmark } from "../bookmarks/store";
import { parseQuery, matchScopeTokens } from "./CommandPalette";
import {
  searchCodebase,
  buildCodebaseIndex,
  getIndexedRoot,
  type SearchResult,
} from "../ai/codebaseSearch";
import { getWorkspaceRoot } from "../workspace/store";
import { explainCommandPrompt, looksLikeCommand } from "../ai/assist";

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
  /** Switch to an AI chat session and show the AI view. */
  selectAiSession: (id: string) => void;
  /** Rewrite the launcher input, e.g. to apply a scope token. */
  setQuery: (value: string) => void;
  openFiles: { path: string; name: string }[];
};

type DynamicState = {
  notes: NoteEntry[];
  containers: DockerContainer[];
  k8s: K8sContextEntry[];
  jobs: BgJob[];
  sshHosts: string[];
  wsFiles: WorkspaceFileEntry[];
  wallpapers: string[];
  scripts: ScriptFile[];
  loaded: boolean;
};

const EMPTY: DynamicState = {
  notes: [],
  containers: [],
  k8s: [],
  jobs: [],
  sshHosts: [],
  wsFiles: [],
  wallpapers: [],
  scripts: [],
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
  const [codeResults, setCodeResults] = useState<SearchResult[]>([]);
  const [codeIndexing, setCodeIndexing] = useState(false);

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
      listWallpapers(getPrefs().background.dir).then((wallpapers) => merge({ wallpapers })),
      listScripts(getPrefs().scriptsDir).then((scripts) => merge({ scripts })),
    ].map((p) => p.catch(() => {}));

    void Promise.allSettled(loads).then(() => merge({ loaded: true }));

    return () => {
      cancelled = true;
    };
  }, [open]);

  // Live ripgrep search when the user scopes to "g".
  useEffect(() => {
    if (!open || scopedKind !== "grep" || !query.trim()) {
      // Reuse the existing array when it is already empty: a fresh [] is never
      // reference-equal, so it would re-run the item memo on every keystroke.
      setGrepResults((r) => (r.length ? [] : r));
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

  /* Ranked code search over the AI index. Unlike "g:" (a single literal string
     through ripgrep) this splits the query into terms, drops stopwords and weights
     filename over content — so a phrase like "pod name parsing" ranks sensibly.
     It is keyword scoring, not embeddings: words that never appear in the code
     will not find it. */
  useEffect(() => {
    if (!open || scopedKind !== "code" || !query.trim()) {
      setCodeResults([]);
      setCodeIndexing(false);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(() => {
      void (async () => {
        const root = getWorkspaceRoot();
        if (!root) return;
        if (getIndexedRoot() !== root) {
          setCodeIndexing(true);
          try {
            await buildCodebaseIndex(root);
          } catch {
            /* leave results empty; the status row explains */
          }
          if (ac.signal.aborted) return;
          setCodeIndexing(false);
        }
        if (ac.signal.aborted) return;
        setCodeResults(searchCodebase(query, 30));
      })();
    }, 150);
    return () => {
      ac.abort();
      clearTimeout(t);
    };
  }, [open, scopedKind, query]);

  const openPaths = useMemo(() => new Set(ctx.openFiles.map((f) => f.path)), [ctx.openFiles]);
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

    /* Scripts from the configured folder.
       Enter TYPES the command rather than running it, matching the panel: a
       script almost always wants arguments, and typing leaves the cursor ready
       for them. "Run now" is the explicit second action. */
    for (const sc of dyn.scripts) {
      const cmd = runCommandFor(sc.path);
      items.push({
        id: `script:${sc.path}`,
        kind: "script",
        label: sc.folder ? `${sc.folder}/${sc.name}` : sc.name,
        hint: sc.lang,
        keywords: `script run ${sc.ext} ${sc.folder}`,
        group: "Scripts",
        run: () => ctx.typeInTerminal(cmd),
        actions: [
          { label: "Open in editor", run: () => ctx.openFile(sc.path, sc.name) },
          { label: "Copy path", run: () => copy(sc.path) },
          { label: "Copy command", run: () => copy(cmd) },
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
        hint: current ? "current" : undefined,
        keywords: "wallpaper background image",
        group: "Wallpaper",
        run: () => applyWallpaper(path),
        actions: [{ label: "Copy path", run: () => copy(path) }],
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
        hint: count ? `${count} message${count === 1 ? "" : "s"}` : "empty",
        keywords: `chat session ai ${sess.source}`,
        group: "Chats",
        run: () => ctx.selectAiSession(sess.id),
        actions: [
          { label: "Copy name", run: () => copy(sess.name) },
          { label: "Delete chat", run: () => deleteSession(sess.id) },
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
      const copyCode = () => {
        const gen = generateTotpCode(acc);
        if (!gen) {
          toast({ title: "Could not generate code", message: name, variant: "error" });
          return;
        }
        copy(gen.code);
        toast({
          title: `Code copied — ${gen.code}`,
          message: `${name} · expires in ${gen.remaining}s`,
          variant: "success",
          duration: 2500,
        });
      };
      items.push({
        id: `totp:${acc.id}`,
        kind: "totp",
        label: name,
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

    // Indexed code search (only in the "code" scope)
    if (scopedKind === "code") {
      for (const r of codeResults) {
        const name = r.path.split("/").pop() ?? r.path;
        const first = r.matches[0];
        items.push({
          id: `code:${r.path}`,
          kind: "code",
          label: r.path,
          hint: first ? `line ${first.line}` : undefined,
          keywords: r.snippet,
          group: "Code",
          run: () =>
            first
              ? ctx.openFileAtLine(r.path, name, first.line)
              : ctx.openFile(r.path, name),
          secondary: { label: "copy path", run: () => copy(r.path) },
        });
      }
      if (codeIndexing) {
        items.push({
          id: "code:indexing",
          kind: "code",
          label: "Building codebase index…",
          group: "Code",
          status: true,
          run: () => {},
        });
      } else if (codeResults.length === 0 && query.trim()) {
        items.push({
          id: "code:none",
          kind: "code",
          label: getWorkspaceRoot() ? "No indexed matches" : "Open a folder to search code",
          group: "Code",
          status: true,
          run: () => {},
        });
      }
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

    return items;
  }, [commands, ctx, dyn, openPaths, clips, bookmarks, scopedKind, grepResults, grepBusy, grepMissingTool, codeResults, codeIndexing]);

  /* Cheap per-keystroke layer: a handful of rows appended to a stable base. */
  return useMemo(() => {
    if (scopedKind) return base;
    const extra: Command[] = [];

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
    if (looksLikeCommand(query)) {
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
    if (query.trim()) {
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
  }, [base, scopedKind, query, ctx]);
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
