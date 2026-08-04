import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CommandDialog,
  Command as CommandRoot,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from "@/components/ui/command";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  SidebarLeftIcon,
  Folder01Icon,
  Settings01Icon,
  Layers01Icon,
  SecurityCheckIcon,
  PuzzleIcon,
  Download01Icon,
  TimeScheduleIcon,
  MessageMultiple02Icon,
  ImageIcon,
  FlashIcon,
  AlertCircleIcon,
  DatabaseIcon,
  Database01Icon,
  Rocket01Icon,
  GlobalIcon,
  GithubIcon,
  FileDiffIcon,
  ClipboardIcon,
  FileAddIcon,
  ComputerTerminal02Icon,
  Cancel01Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
  File01Icon,
  GitBranchIcon,
  SparklesIcon,
  CloudIcon,
  PlusSignIcon,
  PlayIcon,
  FolderCloudIcon,
  CommandIcon,
  DownloadCircle01Icon,
  NotebookIcon,
  Home01Icon,
  CodeIcon,
} from "@hugeicons/core-free-icons";
import { recordCommandUse, getFrecencyScore, getCommandHistory } from "./history";
import { cn } from "@/lib/utils";

export type LauncherKind =
  | "command"
  | "note"
  | "file"
  | "container"
  | "k8s"
  | "workflow"
  | "job"
  | "remote"
  | "clipboard"
  | "bookmark"
  | "grep"
  | "code"
  | "totp"
  | "session"
  | "wallpaper"
  | "script"
  | "ai";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  kind?: LauncherKind;
  /** Extra text merged into the match value. */
  keywords?: string;
  /** Secondary action, triggered with Cmd/Ctrl+Enter. */
  secondary?: { label: string; run: () => void };
  /** Extra verbs listed in the ⌘. action menu, after run() and secondary. */
  actions?: { label: string; hint?: string; run: () => void }[];
  /** Rendered even when cmdk's fuzzy filter would score it 0 — for rows whose
   *  label never matches the query but must stay reachable. */
  alwaysShow?: boolean;
  /** Runs without dismissing the palette — for rows that rewrite the query. */
  keepOpen?: boolean;
  /** Non-interactive status row: implies alwaysShow, and is skipped by keyboard
   *  navigation since cmdk's getValidItems excludes aria-disabled items. */
  status?: boolean;
  run: () => void;
};

const GROUP_ORDER = [
  "Notes",
  "Files",
  "Code",
  "Clipboard",
  "Bookmarks",
  "Workflows",
  "Jobs",
  "Docker",
  "Kubernetes",
  "Remotes",
  "AI",
  "General",
  "View",
  "Tools",
  "Git",
  "Other",
  /* Deliberately near the end: cmdk auto-selects the first row, so putting scope
     suggestions on top would mean typing "doc" and pressing Enter scoped you to
     Docker instead of opening the top result. The per-group "type files: for all"
     rows teach the syntax inline, where it actually matters. */
  "Scopes",
  "Ask AI",
];

/** Rows shown per source before the rest is folded behind its scope token. */
const GROUP_CAP = 8;

/** Groups that correspond to exactly one scope, so "type x: for all" is true.
   "AI"/"Tools"/"General" hold assorted commands, so they get no token hint. */
const GROUP_SCOPE_TOKEN: Record<string, string> = {
  Notes: "notes",
  Files: "files",
  Code: "code",
  Clipboard: "clip",
  Bookmarks: "bookmarks",
  Workflows: "workflows",
  Jobs: "jobs",
  Docker: "docker",
  Kubernetes: "k8s",
  Remotes: "remotes",
};

const SCOPE_LEGEND =
  "scope with n: notes · f: files · code: code · g: grep · c: clip · b: bookmarks · w: workflows · d: docker · k: k8s · r: remotes · j: jobs · > cmd";

const ICON_MAP: Record<string, typeof Search01Icon> = {
  explorer: SidebarLeftIcon,
  "open-folder": Folder01Icon,
  settings: Settings01Icon,
  "settings-window": Settings01Icon,
  workflows: Layers01Icon,
  authenticator: SecurityCheckIcon,
  integrations: PuzzleIcon,
  "install-cli-tools": Download01Icon,
  jobs: TimeScheduleIcon,
  suggest: FlashIcon,
  "explain-error": AlertCircleIcon,
  docker: DatabaseIcon,
  k8s: Database01Icon,
  terraform: Rocket01Icon,
  remotes: GlobalIcon,
  github: GithubIcon,
  cicd: FolderCloudIcon,
  diff: FileDiffIcon,
  totp: SecurityCheckIcon,
  clipboard: ClipboardIcon,
  "new-file": FileAddIcon,
  "new-terminal": ComputerTerminal02Icon,
  "close-tab": Cancel01Icon,
  "close-all-tabs": Cancel01Icon,
  "zoom-in": ZoomInAreaIcon,
  "zoom-out": ZoomOutAreaIcon,
  "sidebar-explorer": Folder01Icon,
  "sidebar-git": GitBranchIcon,
  "sidebar-ai": SparklesIcon,
  "sidebar-remotes": GlobalIcon,
  aws: CloudIcon,
  "open-file": File01Icon,
  "new-tab": PlusSignIcon,
  "run-workflow": PlayIcon,
  "open-clipboard": ClipboardIcon,
  "open-totp": SecurityCheckIcon,
  "check-updates": DownloadCircle01Icon,
  "open-jobs": TimeScheduleIcon,
  "open-authenticator": SecurityCheckIcon,
};

const KIND_META: Record<LauncherKind, { icon: typeof Search01Icon; className: string }> = {
  command: { icon: CommandIcon, className: "text-primary bg-primary/10" },
  note: { icon: NotebookIcon, className: "text-amber-400 bg-amber-500/10" },
  file: { icon: File01Icon, className: "text-sky-400 bg-sky-500/10" },
  container: { icon: DatabaseIcon, className: "text-blue-400 bg-blue-500/10" },
  k8s: { icon: Database01Icon, className: "text-violet-400 bg-violet-500/10" },
  workflow: { icon: PlayIcon, className: "text-emerald-400 bg-emerald-500/10" },
  job: { icon: TimeScheduleIcon, className: "text-orange-400 bg-orange-500/10" },
  remote: { icon: Home01Icon, className: "text-cyan-400 bg-cyan-500/10" },
  clipboard: { icon: ClipboardIcon, className: "text-pink-400 bg-pink-500/10" },
  bookmark: { icon: Folder01Icon, className: "text-yellow-400 bg-yellow-500/10" },
  grep: { icon: ZoomInAreaIcon, className: "text-lime-400 bg-lime-500/10" },
  code: { icon: CodeIcon, className: "text-teal-400 bg-teal-500/10" },
  totp: { icon: TimeScheduleIcon, className: "text-rose-400 bg-rose-500/10" },
  session: { icon: MessageMultiple02Icon, className: "text-indigo-400 bg-indigo-500/10" },
  wallpaper: { icon: ImageIcon, className: "text-purple-400 bg-purple-500/10" },
  script: { icon: CodeIcon, className: "text-emerald-400 bg-emerald-500/10" },
  ai: { icon: SparklesIcon, className: "text-fuchsia-400 bg-fuchsia-500/10" },
};

const SCOPE_LABELS: Record<Exclude<LauncherKind, "command"> | "command", { label: string; className: string }> = {
  command: { label: "Command", className: "text-primary bg-primary/15 border-primary/20" },
  note: { label: "Notes", className: "text-amber-400 bg-amber-500/15 border-amber-500/20" },
  file: { label: "Files", className: "text-sky-400 bg-sky-500/15 border-sky-500/20" },
  container: { label: "Docker", className: "text-blue-400 bg-blue-500/15 border-blue-500/20" },
  k8s: { label: "Kubernetes", className: "text-violet-400 bg-violet-500/15 border-violet-500/20" },
  workflow: { label: "Workflows", className: "text-emerald-400 bg-emerald-500/15 border-emerald-500/20" },
  job: { label: "Jobs", className: "text-orange-400 bg-orange-500/15 border-orange-500/20" },
  remote: { label: "Remotes", className: "text-cyan-400 bg-cyan-500/15 border-cyan-500/20" },
  clipboard: { label: "Clipboard", className: "text-pink-400 bg-pink-500/15 border-pink-500/20" },
  bookmark: { label: "Bookmarks", className: "text-yellow-400 bg-yellow-500/15 border-yellow-500/20" },
  grep: { label: "Grep", className: "text-lime-400 bg-lime-500/15 border-lime-500/20" },
  code: { label: "Code", className: "text-teal-400 bg-teal-500/15 border-teal-500/20" },
  totp: { label: "2FA", className: "text-rose-400 bg-rose-500/15 border-rose-500/20" },
  session: { label: "Chats", className: "text-indigo-400 bg-indigo-500/15 border-indigo-500/20" },
  wallpaper: { label: "Wallpaper", className: "text-purple-400 bg-purple-500/15 border-purple-500/20" },
  script: { label: "Scripts", className: "text-emerald-400 bg-emerald-500/15 border-emerald-500/20" },
  ai: { label: "AI", className: "text-fuchsia-400 bg-fuchsia-500/15 border-fuchsia-500/20" },
};

function ScopePill({ kind, onClear }: { kind: LauncherKind; onClear: () => void }) {
  const meta = SCOPE_LABELS[kind];
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClear();
      }}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:opacity-90",
        meta.className,
      )}
    >
      <span>{meta.label}</span>
      <span className="opacity-50">×</span>
    </button>
  );
}

function getIcon(id: string, kind: LauncherKind): typeof Search01Icon {
  if (kind === "command") {
    if (ICON_MAP[id]) return ICON_MAP[id];
    for (const [key, icon] of Object.entries(ICON_MAP)) {
      if (id.includes(key)) return icon;
    }
  }
  return KIND_META[kind].icon;
}

function getGroup(id: string, label: string): string {
  const lower = `${id} ${label}`.toLowerCase();
  if (lower.includes("ai") || lower.includes("suggest") || lower.includes("explain")) return "AI";
  if (lower.includes("docker") || lower.includes("k8s") || lower.includes("kubernetes") || lower.includes("terraform") || lower.includes("remotes") || lower.includes("github") || lower.includes("cicd") || lower.includes("aws")) return "Tools";
  if (lower.includes("git") || lower.includes("diff")) return "Git";
  if (lower.includes("explorer") || lower.includes("sidebar") || lower.includes("folder") || lower.includes("file") || lower.includes("zoom")) return "View";
  if (lower.includes("settings") || lower.includes("workflows") || lower.includes("authenticator") || lower.includes("integrations") || lower.includes("install") || lower.includes("jobs") || lower.includes("totp") || lower.includes("clipboard") || lower.includes("terminal") || lower.includes("tab")) return "General";
  return "Other";
}

/* Scope tokens are colon-terminated: "n: foo", "clip: foo". A colon never starts
   natural text, so an ordinary query can never be hijacked — the previous
   "<letter><space>" form silently swallowed anything beginning with a single
   letter from the set, so "c program files" became a clipboard search for
   "program files" and clipboard entries like "-n 5" were unsearchable.
   Long aliases exist so you don't have to recall the letter. */
const SCOPE_TOKENS: Record<string, LauncherKind> = {
  cmd: "command", command: "command", commands: "command",
  n: "note", note: "note", notes: "note",
  f: "file", file: "file", files: "file",
  g: "grep", grep: "grep", content: "grep", contents: "grep",
  code: "code", cs: "code", sym: "code", symbol: "code",
  c: "clipboard", clip: "clipboard", clipboard: "clipboard",
  b: "bookmark", bm: "bookmark", bookmark: "bookmark", bookmarks: "bookmark",
  w: "workflow", wf: "workflow", workflow: "workflow", workflows: "workflow",
  d: "container", docker: "container", container: "container", containers: "container",
  k: "k8s", k8s: "k8s", kube: "k8s", kubernetes: "k8s",
  r: "remote", remote: "remote", remotes: "remote", ssh: "remote",
  j: "job", job: "job", jobs: "job",
  otp: "totp", totp: "totp", "2fa": "totp", auth: "totp", mfa: "totp",
  chat: "session", chats: "session", session: "session", sessions: "session",
  wall: "wallpaper", wallpaper: "wallpaper", wallpapers: "wallpaper", bg: "wallpaper",
  sc: "script", script: "script", scripts: "script",
};

/** The token shown when suggesting a scope, per kind. */
const SCOPE_CANONICAL: Partial<Record<LauncherKind, string>> = {
  command: "cmd",
  note: "notes",
  file: "files",
  grep: "grep",
  code: "code",
  clipboard: "clip",
  bookmark: "bookmarks",
  workflow: "workflows",
  container: "docker",
  k8s: "k8s",
  remote: "remotes",
  job: "jobs",
  totp: "otp",
  session: "chats",
  wallpaper: "wall",
  script: "scripts",
};

/**
 * Scopes are only advertised in the footer, and that legend hides as soon as you
 * type — so typing a source name offers the scope as a row instead. Requires two
 * characters so it does not fire on every keystroke.
 */
export function matchScopeTokens(raw: string): { token: string; kind: LauncherKind }[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  const seen = new Set<LauncherKind>();
  const out: { token: string; kind: LauncherKind }[] = [];
  for (const [alias, kind] of Object.entries(SCOPE_TOKENS)) {
    if (seen.has(kind)) continue;
    const label = SCOPE_LABELS[kind]?.label.toLowerCase() ?? "";
    if (alias.startsWith(q) || label.startsWith(q)) {
      seen.add(kind);
      out.push({ token: SCOPE_CANONICAL[kind] ?? alias, kind });
    }
  }
  return out;
}

export function parseQuery(raw: string): { kind: LauncherKind | null; query: string } {
  if (raw.startsWith(">")) return { kind: "command", query: raw.slice(1).trimStart() };
  // The (?![/\\]) guard keeps URLs and Windows-ish paths out: "https://x" and
  // "c:\Users" are queries, not scopes. An unrecognised token also falls through
  // with the query intact rather than being eaten.
  const m = raw.match(/^([A-Za-z0-9]{1,10}):(?![/\\])\s*([\s\S]*)$/);
  if (m) {
    const kind = SCOPE_TOKENS[m[1].toLowerCase()];
    if (kind) return { kind, query: m[2] };
  }
  return { kind: null, query: raw };
}

/** Match scoring for the cmdk filter. Higher = better; 0 hides the item. */
function rankText(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  // Word-boundary match: each query char begins a word.
  let ti = 0;
  let qi = 0;
  let wordStart = true;
  let wordMatched = 0;
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (!wordStart) {
        // Not a word start; abort boundary match.
        wordMatched = -1;
        break;
      }
      wordMatched++;
      qi++;
      ti++;
      wordStart = false;
    } else {
      ti++;
      if (!/[a-z0-9]/.test(t[ti - 1] ?? "")) wordStart = true;
    }
  }
  if (wordMatched === q.length) return 60;
  if (t.includes(q)) return 40;
  // Fuzzy subsequence.
  qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length ? 20 : 0;
}

function rankMatch(value: string, query: string): number {
  const q = parseQuery(query).query;
  if (!q) return 1;
  const [label, id, keywords] = value.split("\t");
  const meta = `${id ?? ""} ${keywords ?? ""}`;
  return Math.max(rankText(label ?? "", q), rankText(meta, q));
}

/** Returns the indices of characters in `text` that match the fuzzy query,
 *  preferring exact substring, then prefix/word boundaries, then subsequence. */
function getMatchIndices(text: string, query: string): number[] {
  if (!query) return [];
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const sub = t.indexOf(q);
  if (sub !== -1) return Array.from({ length: q.length }, (_, i) => sub + i);
  // Word-boundary greedy match.
  let ti = 0;
  let qi = 0;
  let wordStart = true;
  const wordIndices: number[] = [];
  while (ti < t.length && qi < q.length) {
    if (t[ti] === q[qi]) {
      if (!wordStart) { wordIndices.length = 0; break; }
      wordIndices.push(ti);
      qi++;
      ti++;
      wordStart = false;
    } else {
      ti++;
      if (!/[a-z0-9]/.test(t[ti - 1] ?? "")) wordStart = true;
    }
  }
  if (wordIndices.length === q.length) return wordIndices;
  // Fallback subsequence.
  const indices: number[] = [];
  qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { indices.push(i); qi++; }
  }
  return indices;
}

function HighlightLabel({ text, indices, className }: { text: string; indices: number[]; className?: string }) {
  if (!indices.length) return <span className={cn("truncate", className)}>{text}</span>;
  const set = new Set(indices);
  const parts: { char: string; match: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    parts.push({ char: text[i], match: set.has(i) });
  }
  const nodes: ReactNode[] = [];
  let buf = "";
  let bufMatch = false;
  for (const p of parts) {
    if (p.match === bufMatch) {
      buf += p.char;
    } else {
      if (buf) {
        nodes.push(
          bufMatch ? (
            <span key={nodes.length} className="cmdk-match">{buf}</span>
          ) : (
            <span key={nodes.length}>{buf}</span>
          ),
        );
      }
      buf = p.char;
      bufMatch = p.match;
    }
  }
  if (buf) {
    nodes.push(
      bufMatch ? (
        <span key={nodes.length} className="cmdk-match">{buf}</span>
      ) : (
        <span key={nodes.length}>{buf}</span>
      ),
    );
  }
  return <span className={cn("truncate", className)}>{nodes}</span>;
}

export function CommandPalette({
  open,
  commands,
  inputValue,
  onInputChange,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  inputValue?: string;
  onInputChange?: (value: string) => void;
  onClose: () => void;
}) {
  /* Local state is authoritative for what the field displays.
     It used to be `inputValue ?? internalInput`, i.e. the parent's state drove the
     value. That froze the field: `??` only falls back on null/undefined, never on
     a string, so any stale `inputValue` (an empty string, or the first character)
     pinned the display there and every later keystroke was discarded on the next
     render — you could type exactly one character.
     The parent is still notified via onInputChange, because it needs the query to
     assemble launcher items, but it no longer dictates the value. Externally
     driven rewrites (a scope row calling ctx.setQuery) are adopted by the effect
     below; the echo of our own keystrokes is ignored via lastPushedRef. */
  const [internalInput, setInternalInput] = useState(inputValue ?? "");
  const rawInput = internalInput;
  const lastPushedRef = useRef(inputValue ?? "");
  const setRawInput = (v: string) => {
    lastPushedRef.current = v;
    setInternalInput(v);
    onInputChange?.(v);
  };

  useEffect(() => {
    if (inputValue === undefined) return;
    if (inputValue === lastPushedRef.current) return; // our own change coming back
    lastPushedRef.current = inputValue;
    setInternalInput(inputValue);
  }, [inputValue]);
  const [selectedValue, setSelectedValue] = useState("");
  const [actionTarget, setActionTarget] = useState<Command | null>(null);
  const preActionInputRef = useRef("");
  const historyIndexRef = useRef(-1);
  const historyRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      document.body.style.pointerEvents = "";
    };
  }, []);

  // Reset input each time the palette opens
  useEffect(() => {
    if (open) {
      setRawInput("");
      historyIndexRef.current = -1;
    }
  }, [open]);

  /* Claim focus in a LAYOUT effect, which runs before passive effects — and
     Radix's focus scope autofocuses from a passive effect (useEffect). Winning
     that race matters for more than ordering: Radix's focus helper only calls
     .select() when the element it focuses was not already the active element, so
     if the input already has focus its autofocus becomes a no-op instead of
     select-alling the query. Belt and braces: onOpenAutoFocus is also prevented,
     and any selection we did not ask for is collapsed by handleSelectionChange. */
  useLayoutEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
    // Second pass after paint: the palette is lazy-loaded behind Suspense, so on
    // the very first open the ref can still be null during this layout pass.
    const frame = requestAnimationFrame(() => {
      const later = inputRef.current;
      if (!later || document.activeElement === later) return;
      later.focus();
      const end = later.value.length;
      later.setSelectionRange(end, end);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  /* Radix's focus scope calls .select() from six places — mount autofocus, focus
     re-entry, focus-out recovery, unmount, and its Tab loop. Suppressing only the
     mount path left the others, and a select-alled query means the next keypress
     REPLACES it rather than appending, so the field appears to accept just one
     word. Collapse any full-value selection we did not initiate; a genuine Cmd+A
     or mouse selection is preserved via the gesture timestamp. */
  const userSelectAtRef = useRef(0);
  const markUserSelection = () => {
    userSelectAtRef.current = Date.now();
  };
  const handleSelectionChange = (e: React.SyntheticEvent<HTMLInputElement>) => {
    if (Date.now() - userSelectAtRef.current < 500) return; // user asked for it
    const el = e.currentTarget;
    const whole = el.selectionStart === 0 && el.selectionEnd === el.value.length;
    if (!whole || el.value.length === 0) return;
    const end = el.value.length;
    // Collapsing fires another select event, but it is no longer a full-value
    // selection, so this does not recurse.
    el.setSelectionRange(end, end);
  };

  const { kind: scopedKind, query } = useMemo(() => parseQuery(rawInput), [rawInput]);

  const enriched = useMemo(() => {
    const q = query.trim();
    const list = commands
      .filter((c) => !scopedKind || (c.kind ?? "command") === scopedKind)
      .map((c) => {
        const rank = q ? rankMatch(`${c.label}\t${c.id}\t${c.keywords ?? ""}`, rawInput) : 0;
        return {
          ...c,
          group: c.group || getGroup(c.id, c.label),
          frecency: getFrecencyScore(c.id),
          rank,
        };
      });
    if (!q) {
      list.sort((a, b) => b.frecency - a.frecency);
    } else {
      list.sort((a, b) => {
        if (a.rank !== b.rank) return b.rank - a.rank;
        return b.frecency - a.frecency;
      });
    }
    return list;
  }, [commands, query, scopedKind, rawInput]);

  const groups = useMemo(() => {
    const map = new Map<string, typeof enriched>();
    for (const cmd of enriched) {
      const list = map.get(cmd.group) || [];
      list.push(cmd);
      map.set(cmd.group, list);
    }
    return map;
  }, [enriched]);

  /* Results are grouped by source and rendered in GROUP_ORDER, so a source with
     hundreds of hits doesn't out-rank the others — it pushes them below the fold.
     Searching "config" matches ~200 workspace files, and Files sits above
     Clipboard, so a clipboard hit ends up hundreds of rows down. Each group shows
     its best few unscoped and advertises the token that reveals the rest; a scope
     means "I want this source", so caps are lifted there. */
  const sortedGroups = useMemo(() => {
    return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => {
      const all = groups.get(g)!;
      if (scopedKind || all.length <= GROUP_CAP) return { name: g, items: all, hidden: 0 };
      return { name: g, items: all.slice(0, GROUP_CAP), hidden: all.length - GROUP_CAP };
    });
  }, [groups, scopedKind]);

  /* Only gate on "the user typed something". cmdk's Empty renders itself only
     when its own filtered count is 0, so testing sortedGroups here was wrong:
     Husk renders every in-scope item and lets cmdk filter, meaning sortedGroups
     stays non-empty even when nothing matches — and the palette showed a blank
     box instead of a message. */
  const hasQuery = rawInput.trim().length > 0;

  const handleSelect = (cmd: Command) => {
    if (cmd.keepOpen) {
      // Not a real command: don't record frecency and don't dismiss.
      cmd.run();
      return;
    }
    recordCommandUse(cmd.id);
    cmd.run();
    onClose();
  };

  const resolveSelected = (): Command | null => {
    const id = selectedValue.split("\t")[1] ?? selectedValue;
    return commands.find((c) => c.id === id) ?? null;
  };

  const handleSecondary = () => {
    const cmd = resolveSelected();
    if (cmd?.secondary) {
      recordCommandUse(cmd.id);
      cmd.secondary.run();
      onClose();
    }
  };

  /* ── Action menu (⌘.) ───────────────────────────────────────────────────
     Entering clears the query so cmdk's fuzzy filter doesn't score every action
     to zero against the old search text; typing then filters the actions. The
     original query is restored on exit. */
  const openActions = () => {
    const cmd = resolveSelected();
    if (!cmd || cmd.status) return;
    preActionInputRef.current = rawInput;
    setActionTarget(cmd);
    setRawInput("");
  };

  const closeActions = () => {
    setActionTarget(null);
    setRawInput(preActionInputRef.current);
    preActionInputRef.current = "";
  };

  const actionsFor = (cmd: Command) => {
    const list: { label: string; hint?: string; run: () => void }[] = [
      { label: (cmd.kind ?? "command") === "command" ? "Run" : "Open", hint: "↵", run: cmd.run },
    ];
    if (cmd.secondary) {
      const l = cmd.secondary.label;
      list.push({ label: l.charAt(0).toUpperCase() + l.slice(1), hint: "⌘↵", run: cmd.secondary.run });
    }
    if (cmd.actions) list.push(...cmd.actions);
    return list;
  };

  const runAction = (cmd: Command, action: { run: () => void }) => {
    recordCommandUse(cmd.id);
    action.run();
    onClose();
  };

  const historyStep = (dir: 1 | -1) => {
    if (dir === 1 && historyIndexRef.current === -1) {
      historyRef.current = getCommandHistory();
    }
    const hist = historyRef.current;
    if (hist.length === 0) return;
    historyIndexRef.current =
      dir === 1
        ? Math.min(historyIndexRef.current + 1, hist.length - 1)
        : Math.max(historyIndexRef.current - 1, -1);
    if (historyIndexRef.current === -1) {
      setRawInput("");
      return;
    }
    const id = hist[hist.length - 1 - historyIndexRef.current];
    const cmd = commands.find((c) => c.id === id);
    if (cmd) setRawInput(cmd.label);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Mid-composition keys belong to the IME, not to us. cmdk skips these too.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;

    // A deliberate select-all must survive handleSelectionChange.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") markUserSelection();

    // ⌘. toggles the action menu for the selected row. Deliberately not Tab
    // (navigation) nor → (moves the caret inside the query) nor ⌘K (opens the
    // palette itself).
    if ((e.metaKey || e.ctrlKey) && e.key === ".") {
      e.preventDefault();
      if (actionTarget) closeActions();
      else openActions();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSecondary();
      return;
    }

    // Tab/Shift+Tab mirror ArrowDown/ArrowUp. cmdk has no Tab binding, so
    // re-emit the arrow it does handle — going through cmdk's own next/prev is
    // what scrolls the new selection into view.
    if (e.key === "Tab" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.currentTarget.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.shiftKey ? "ArrowUp" : "ArrowDown",
          bubbles: true,
          // Without this the event is uncancelable and cmdk's preventDefault()
          // silently no-ops.
          cancelable: true,
        }),
      );
      return;
    }

    // Command history lives on Alt+Arrow. Plain arrows must stay with the result
    // list: cmdk bails on defaultPrevented, so hijacking them here used to make
    // the list unnavigable whenever the query was empty.
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      historyStep(e.key === "ArrowUp" ? 1 : -1);
    }
  };

  return (
    <CommandDialog
      open={open}
      className="sm:max-w-[520px]"
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      /* Radix's focus scope autofocuses the first tabbable element with
         select:true, which select-alls the query — so the next character replaces
         it instead of appending, and you can never type more than one letter. We
         focus the input ourselves (without selecting), so suppress theirs. */
      onOpenAutoFocus={(e) => e.preventDefault()}
      onEscapeKeyDown={(e) => {
        // First Escape backs out of the action menu; a second one closes.
        if (actionTarget) {
          e.preventDefault();
          closeActions();
        }
      }}
    >
      <CommandRoot
        value={selectedValue}
        onValueChange={setSelectedValue}
        filter={(value, search) => rankMatch(value, search)}
      >
        <CommandInput
          ref={inputRef}
          autoFocus
          leftSlot={
            actionTarget ? (
              <ScopePill kind={actionTarget.kind ?? "command"} onClear={closeActions} />
            ) : scopedKind ? (
              <ScopePill kind={scopedKind} onClear={() => setRawInput(query)} />
            ) : undefined
          }
          placeholder={
            actionTarget
              ? `Filter actions for ${actionTarget.label}…`
              : scopedKind
                ? `Search ${SCOPE_LABELS[scopedKind].label.toLowerCase()}…`
                : "Search everything — notes, files, docker, k8s, workflows…"
          }
          value={rawInput}
          onValueChange={(v) => {
            // Typing leaves the history walk, so the cursor must not persist.
            historyIndexRef.current = -1;
            setRawInput(v);
          }}
          onKeyDown={handleKeyDown}
          onSelect={handleSelectionChange}
          onPointerDown={markUserSelection}
          onDoubleClick={markUserSelection}
        />
        <CommandList>
          {hasQuery && !actionTarget && <CommandEmpty>No results found.</CommandEmpty>}
          {/* cmdk only renders Empty when the filtered count is 0, so this needs
              no extra condition beyond being in action mode. */}
          {actionTarget && <CommandEmpty>No matching actions.</CommandEmpty>}

          {actionTarget ? (
            <CommandGroup heading={`Actions — ${actionTarget.label}`}>
              {actionsFor(actionTarget).map((action, i) => (
                <CommandItem
                  key={`${action.label}:${i}`}
                  value={`${action.label}\taction:${i}\t`}
                  onSelect={() => runAction(actionTarget, action)}
                >
                  <div
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded",
                      KIND_META[actionTarget.kind ?? "command"].className,
                    )}
                  >
                    <HugeiconsIcon icon={FlashIcon} size={13} strokeWidth={1.5} />
                  </div>
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {action.hint ? <CommandShortcut>{action.hint}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {!actionTarget && sortedGroups.map((group) => (
            /* A group is hidden unless one of its items scores > 0, which would
               swallow a status row whose label never matches the query. */
            <CommandGroup
              key={group.name}
              heading={group.name}
              forceMount={group.items.some((i) => i.status || i.alwaysShow) || undefined}
            >
              {group.items.map((cmd) => {
                const kind = cmd.kind ?? "command";
                const Icon = getIcon(cmd.id, kind);
                const meta = KIND_META[kind];
                const indices = getMatchIndices(cmd.label, query);
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`${cmd.label}\t${cmd.id}\t${cmd.keywords ?? ""}`}
                    keywords={[cmd.id, cmd.keywords ?? "", cmd.group ?? ""]}
                    forceMount={cmd.status || cmd.alwaysShow || undefined}
                    disabled={cmd.status || undefined}
                    onSelect={() => handleSelect(cmd)}
                  >
                    <div className={cn("flex size-5 shrink-0 items-center justify-center rounded", meta.className)}>
                      <HugeiconsIcon icon={Icon} size={13} strokeWidth={1.5} />
                    </div>
                    <HighlightLabel text={cmd.label} indices={indices} className="min-w-0 flex-1" />
                    {cmd.hint ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground/60">{cmd.hint}</span>
                    ) : null}
                    {cmd.secondary ? (
                      <CommandShortcut>⌘↵ {cmd.secondary.label}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
              {group.hidden > 0 && GROUP_SCOPE_TOKEN[group.name] ? (
                /* forceMount + disabled, not a plain div: cmdk re-appends item
                   nodes to sort them, which would leave a bare div stranded above
                   the rows. As a zero-scoring item it sorts to the end, and
                   disabled keeps it out of keyboard navigation. No count — cmdk
                   filters the surviving rows further, so any number we computed
                   here would contradict what is on screen. */
                <CommandItem
                  key={`${group.name}:more`}
                  value={`\tmore:${group.name}\t`}
                  forceMount
                  disabled
                  className="pl-9 text-[10px] text-muted-foreground/40"
                  onSelect={() => {}}
                >
                  type “{GROUP_SCOPE_TOKEN[group.name]}:” for all matches
                </CommandItem>
              ) : null}
            </CommandGroup>
          ))}
        </CommandList>
        <div className="flex items-center gap-3 border-t border-border/50 px-3 py-1.5 text-[9.5px] text-muted-foreground/50">
          <span className="shrink-0">↵ open</span>
          {actionTarget ? (
            <span className="shrink-0">esc back</span>
          ) : (
            <>
              <span className="shrink-0">⌘↵ action</span>
              <span className="shrink-0">⌘. actions</span>
              <span className="shrink-0">⇥ next</span>
            </>
          )}
          {/* Truncates rather than pushing the row wider than the 520px panel.
              The scope legend only earns its space before you start typing —
              once there's a query the pill already shows the active scope. */}
          <span className="ml-auto min-w-0 truncate">
            {actionTarget
              ? `${actionsFor(actionTarget).length} actions`
              : hasQuery
                ? "⌥↑ history"
                : SCOPE_LEGEND}
          </span>
        </div>
      </CommandRoot>
    </CommandDialog>
  );
}
