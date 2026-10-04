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
  CommandIcon,
  DownloadCircle01Icon,
  NotebookIcon,
  Home01Icon,
  CodeIcon,
} from "@hugeicons/core-free-icons";
import { recordCommandUse, getFrecencyScore, getCommandHistory } from "./history";
import { cn } from "@/lib/utils";
import { parseQuery, scopeQuery } from "./query";
import "./CommandPalette.css";

export { matchScopeTokens, parseQuery } from "./query";

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
  | "ai";

export type CommandConfirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
};

export type CommandAction = {
  label: string;
  hint?: string;
  confirmation?: CommandConfirmation;
  run: () => void | Promise<void>;
};

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  kind?: LauncherKind;
  /** Extra text merged into the match value. */
  keywords?: string;
  /** Full path, destination, or other context shown for the selected result. */
  detail?: string;
  /** Human-readable Enter action, also used in the actions menu. */
  primaryLabel?: string;
  confirmation?: CommandConfirmation;
  /** Secondary action, triggered with Cmd/Ctrl+Enter. */
  secondary?: CommandAction;
  /** Extra verbs listed in the ⌘. action menu, after run() and secondary. */
  actions?: CommandAction[];
  /** Rendered even when cmdk's fuzzy filter would score it 0 — for rows whose
   *  label never matches the query but must stay reachable. */
  alwaysShow?: boolean;
  /** Preserve a search provider's relevance order instead of fuzzy-ranking again. */
  searchScore?: number;
  /** Runs without dismissing the palette — for rows that rewrite the query. */
  keepOpen?: boolean;
  /** Non-interactive status row: implies alwaysShow, and is skipped by keyboard
   *  navigation since cmdk's getValidItems excludes aria-disabled items. */
  status?: boolean;
  run: () => void | Promise<void>;
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
  "Chats",
  "Wallpaper",
  "2FA",
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

const FILTER_KINDS: LauncherKind[] = [
  "command", "note", "file", "grep", "code", "clipboard", "bookmark", "workflow",
  "job", "container", "k8s", "remote", "session", "wallpaper", "totp",
];

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
  remotes: GlobalIcon,
  github: GithubIcon,
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
      aria-label={`Clear ${meta.label} filter`}
      className={cn("launcher-scope-pill flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.className)}
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
  if (lower.includes("docker") || lower.includes("k8s") || lower.includes("kubernetes") || lower.includes("remotes") || lower.includes("github") || lower.includes("aws")) return "Tools";
  if (lower.includes("git") || lower.includes("diff")) return "Git";
  if (lower.includes("explorer") || lower.includes("sidebar") || lower.includes("folder") || lower.includes("file") || lower.includes("zoom")) return "View";
  if (lower.includes("settings") || lower.includes("workflows") || lower.includes("authenticator") || lower.includes("plugins") || lower.includes("install") || lower.includes("jobs") || lower.includes("totp") || lower.includes("clipboard") || lower.includes("terminal") || lower.includes("tab")) return "General";
  return "Other";
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
  const [confirmation, setConfirmation] = useState<{ command: Command; action: CommandAction } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const preActionInputRef = useRef("");
  const historyIndexRef = useRef(-1);
  const historyRef = useRef<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const modifier = isMac ? "⌘" : "Ctrl+";
  const historyShortcut = isMac ? "⌥↑" : "Alt+↑";
  const filterShortcut = isMac ? "⌥S" : "Alt+S";

  // Reset input each time the palette opens
  useEffect(() => {
    if (open) {
      setRawInput("");
      historyIndexRef.current = -1;
      setActionTarget(null);
      setConfirmation(null);
      setError(null);
      setFiltersVisible(false);
      setExpandedGroups(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (confirmation && !running) cancelRef.current?.focus();
  }, [confirmation, running]);

  useEffect(() => {
    setExpandedGroups(new Set());
  }, [rawInput]);

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

  // Filter before capping, and disable cmdk's second filtering/sorting pass.
  // alwaysShow is also used by sources that already ranked content matches.
  const enriched = useMemo(() => {
    const q = query.trim();
    return commands
      .filter((c) => !scopedKind || (c.kind ?? "command") === scopedKind)
      .map((c) => ({
        ...c,
        group: c.group || getGroup(c.id, c.label),
        frecency: getFrecencyScore(c.id),
        rank: q ? (Number.isFinite(c.searchScore) ? c.searchScore!
          : rankMatch(c.label + "\t" + c.id + "\t" + (c.keywords ?? ""), rawInput)) : 0,
      }))
      .filter((c) => !q || c.rank > 0 || c.alwaysShow || c.status)
      .sort((a, b) => b.rank - a.rank || b.frecency - a.frecency);
  }, [commands, query, scopedKind, rawInput, open]);

  const sortedGroups = useMemo(() => {
    const available = new Map(enriched.map((command) => [command.id, command]));
    const recent = !scopedKind && !query.trim()
      ? getCommandHistory()
        .map((id) => available.get(id))
        .filter((command): command is typeof enriched[number] => !!command && !command.status && !command.keepOpen)
        .slice(0, 5)
      : [];
    const recentIds = new Set(recent.map((command) => command.id));
    const groups = new Map<string, typeof enriched>();
    for (const command of enriched) {
      if (recentIds.has(command.id)) continue;
      const group = groups.get(command.group) ?? [];
      group.push(command);
      groups.set(command.group, group);
    }
    // Unknown producer groups must remain reachable, too.
    const names = [
      ...GROUP_ORDER.filter((name) => groups.has(name)),
      ...[...groups.keys()].filter((name) => !GROUP_ORDER.includes(name)),
    ];
    const result = names.map((name) => {
      const all = groups.get(name)!;
      const results = all.filter((command) => !command.status);
      const capped = !scopedKind && !expandedGroups.has(name) && results.length > GROUP_CAP;
      const visibleIds = new Set(results.slice(0, GROUP_CAP).map((command) => command.id));
      const items = capped ? all.filter((command) => command.status || visibleIds.has(command.id)) : all;
      const kinds = new Set(results.map((command) => command.kind ?? "command"));
      const onlyKind = kinds.size === 1 ? [...kinds][0] : null;
      return { name, items, hidden: capped ? results.length - GROUP_CAP : 0, kind: onlyKind };
    });
    return recent.length
      ? [{ name: "Recent", items: recent, hidden: 0, kind: null }, ...result]
      : result;
  }, [enriched, scopedKind, query, expandedGroups]);

  const resolveSelected = (): Command | null => commands.find((command) => command.id === selectedValue) ?? null;
  const primaryAction = (command: Command): CommandAction => ({
    label: command.primaryLabel ?? ((command.kind ?? "command") === "command" ? "Run" : "Open"),
    hint: "↵",
    confirmation: command.confirmation,
    run: command.run,
  });
  const actionsFor = (command: Command): CommandAction[] => [
    primaryAction(command),
    ...(command.secondary ? [{ ...command.secondary, hint: modifier + "↵" }] : []),
    ...(command.actions ?? []),
  ];
  const visibleActions = actionTarget
    ? actionsFor(actionTarget).map((action, index) => ({ ...action, index }))
      .filter((action) => !rawInput.trim() || rankText(action.label + " " + (action.hint ?? ""), rawInput.trim()) > 0)
    : [];
  const selectedCommand = actionTarget ?? resolveSelected();
  const selectedAction = actionTarget
    ? visibleActions.find((action) => "action:" + action.index === selectedValue)
    : selectedCommand ? primaryAction(selectedCommand) : null;
  const moreGroup = sortedGroups.find((group) => "more:" + group.name === selectedValue);

  const restoreInputFocus = () => requestAnimationFrame(() => inputRef.current?.focus());
  const closeActions = () => {
    setActionTarget(null);
    setRawInput(preActionInputRef.current);
    preActionInputRef.current = "";
    setError(null);
    restoreInputFocus();
  };
  const openActions = () => {
    const command = resolveSelected();
    if (!command || command.status || runningRef.current) return;
    preActionInputRef.current = rawInput;
    setActionTarget(command);
    setRawInput("");
    setError(null);
  };
  const cancelConfirmation = () => {
    if (runningRef.current) return;
    setConfirmation(null);
    setError(null);
    restoreInputFocus();
  };

  const execute = async (command: Command, action: CommandAction) => {
    if (runningRef.current || command.status) return;
    runningRef.current = true;
    setRunning(true);
    setError(null);
    // Restore the source query before a scope action rewrites it, not afterwards.
    if (command.keepOpen && actionTarget) closeActions();
    try {
      await action.run();
      if (!command.keepOpen) recordCommandUse(command.id);
      setConfirmation(null);
      if (!command.keepOpen) onClose();
      else restoreInputFocus();
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : String(cause)).slice(0, 1000));
      if (!confirmation) restoreInputFocus();
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  };
  const requestAction = (command: Command, action: CommandAction) => {
    if (runningRef.current || command.status) return;
    setError(null);
    if (action.confirmation) {
      setConfirmation({ command, action });
      return;
    }
    void execute(command, action);
  };

  const applyScope = (kind: LauncherKind | null) => {
    setRawInput(scopeQuery(kind, rawInput));
    setFiltersVisible(false);
    historyIndexRef.current = -1;
    setError(null);
    restoreInputFocus();
  };
  const focusFilters = (toggle = false) => {
    if (toggle && filtersVisible) {
      setFiltersVisible(false);
      restoreInputFocus();
      return;
    }
    setFiltersVisible(true);
    requestAnimationFrame(() => filtersRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus());
  };
  const showMore = (group: typeof sortedGroups[number]) => {
    // Files may contain grep hits. Infer the scope from rows, never the heading.
    if (group.kind && FILTER_KINDS.includes(group.kind)) applyScope(group.kind);
    else setExpandedGroups((previous) => new Set([...previous, group.name]));
  };
  const historyStep = (direction: 1 | -1) => {
    if (direction === 1 && historyIndexRef.current === -1) {
      const available = new Set(commands.filter((command) => !command.status && !command.keepOpen).map((command) => command.id));
      historyRef.current = getCommandHistory().filter((id) => available.has(id));
    }
    const history = historyRef.current;
    if (!history.length) return;
    historyIndexRef.current = direction === 1
      ? Math.min(historyIndexRef.current + 1, history.length - 1)
      : Math.max(historyIndexRef.current - 1, -1);
    const command = commands.find((item) => item.id === history[historyIndexRef.current]);
    setRawInput(command?.label ?? "");
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (runningRef.current) {
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") markUserSelection();
    if (!actionTarget && event.altKey && (event.code === "KeyS" || event.key.toLowerCase() === "s")) {
      event.preventDefault();
      focusFilters();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === ".") {
      event.preventDefault();
      if (actionTarget) closeActions();
      else openActions();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      // Action-menu Enter must execute the selected verb, not an unrelated row.
      if (actionTarget) {
        if (selectedAction) requestAction(actionTarget, selectedAction);
      } else {
        const command = resolveSelected();
        if (command?.secondary) requestAction(command, command.secondary);
      }
      return;
    }
    if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.currentTarget.dispatchEvent(new KeyboardEvent("keydown", {
        key: event.shiftKey ? "ArrowUp" : "ArrowDown",
        bubbles: true,
        cancelable: true,
      }));
      return;
    }
    if (!actionTarget && event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      historyStep(event.key === "ArrowUp" ? 1 : -1);
    }
  };

  return (
    <CommandDialog
      open={open}
      className="launcher-palette sm:max-w-[520px]"
      onOpenChange={(nextOpen) => { if (!nextOpen && !runningRef.current) onClose(); }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => {
        if (runningRef.current) event.preventDefault();
        else if (confirmation) {
          event.preventDefault();
          cancelConfirmation();
        } else if (actionTarget) {
          event.preventDefault();
          closeActions();
        } else if (filtersRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          setFiltersVisible(false);
          restoreInputFocus();
        }
      }}
    >
      {confirmation ? (
        <section role="alertdialog" aria-modal="true" aria-labelledby="launcher-confirm-title" aria-describedby="launcher-confirm-description" className="launcher-confirmation p-4">
          <h2 id="launcher-confirm-title" className="text-sm font-medium">{confirmation.action.confirmation!.title}</h2>
          <p id="launcher-confirm-description" className="launcher-confirm-description mt-2 whitespace-pre-wrap break-all text-xs leading-relaxed text-muted-foreground">{confirmation.action.confirmation!.description}</p>
          {error && <p role="alert" className="launcher-error mt-3 text-xs text-destructive">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button ref={cancelRef} type="button" disabled={running} className="launcher-confirm-button" onClick={cancelConfirmation}>Cancel</button>
            <button type="button" disabled={running} className="launcher-confirm-button launcher-confirm-primary" onClick={() => void execute(confirmation.command, confirmation.action)}>
              {running ? "Working…" : confirmation.action.confirmation!.confirmLabel ?? confirmation.action.label}
            </button>
          </div>
        </section>
      ) : (
        <CommandRoot
          value={selectedValue} onValueChange={setSelectedValue} shouldFilter={false} loop aria-busy={running}
          onKeyDownCapture={(event) => {
            // Native buttons (source filters, scope clear, footer) must activate
            // themselves, not cmdk's currently selected result as well.
            if (event.key === "Enter" && event.target instanceof Element && event.target.closest("button")) {
              event.stopPropagation();
            }
          }}
        >
          <CommandInput
            ref={inputRef}
            autoFocus
            disabled={running}
            leftSlot={actionTarget
              ? <ScopePill kind={actionTarget.kind ?? "command"} onClear={closeActions} />
              : scopedKind ? <ScopePill kind={scopedKind} onClear={() => applyScope(null)} /> : undefined}
            placeholder={actionTarget
              ? "Filter actions for " + actionTarget.label + "…"
              : scopedKind ? "Search " + SCOPE_LABELS[scopedKind].label.toLowerCase() + "…"
                : "Search everything — notes, files, docker, k8s, workflows…"}
            value={rawInput}
            onValueChange={(value) => {
              historyIndexRef.current = -1;
              setRawInput(value);
              setError(null);
            }}
            onKeyDown={handleKeyDown}
            onSelect={handleSelectionChange}
            onPointerDown={markUserSelection}
            onDoubleClick={markUserSelection}
          />
          {!actionTarget && (
            <div
              ref={filtersRef}
              id="launcher-source-filters"
              className="launcher-filters"
              hidden={!filtersVisible}
              role="group"
              aria-label="Filter results by source"
              aria-keyshortcuts="Alt+S"
              onKeyDown={(event) => {
                const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                if (index < 0) return;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                  event.preventDefault();
                  event.stopPropagation();
                  buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
                }
              }}
            >
              <button type="button" aria-pressed={!scopedKind} disabled={running} onClick={() => applyScope(null)}>All</button>
              {FILTER_KINDS.map((kind) => (
                <button key={kind} type="button" aria-pressed={scopedKind === kind} disabled={running} onClick={() => applyScope(kind)}>
                  {SCOPE_LABELS[kind].label}
                </button>
              ))}
            </div>
          )}
          <CommandList>
            <CommandEmpty>{actionTarget ? "No matching actions." : "No results found."}</CommandEmpty>
            {actionTarget ? (
              <CommandGroup heading={"Actions — " + actionTarget.label}>
                {visibleActions.map((action) => (
                  <CommandItem key={action.index} value={"action:" + action.index} disabled={running} onSelect={() => requestAction(actionTarget, action)}>
                    <span aria-hidden="true" data-kind={actionTarget.kind ?? "command"} className={cn("launcher-kind-icon", KIND_META[actionTarget.kind ?? "command"].className)}>
                      <HugeiconsIcon icon={FlashIcon} size={13} strokeWidth={1.5} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{action.label}</span>
                    {action.hint && <CommandShortcut>{action.hint}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : sortedGroups.map((group) => (
              <CommandGroup key={group.name} heading={group.name}>
                {group.items.map((command) => (
                  <CommandItem
                    key={command.id}
                    value={command.id}
                    disabled={command.status || running || undefined}
                    onSelect={() => requestAction(command, primaryAction(command))}
                  >
                    <span aria-hidden="true" data-kind={command.kind ?? "command"} className={cn("launcher-kind-icon", KIND_META[command.kind ?? "command"].className)}>
                      <HugeiconsIcon icon={getIcon(command.id, command.kind ?? "command")} size={13} strokeWidth={1.5} />
                    </span>
                    <HighlightLabel text={command.label} indices={getMatchIndices(command.label, query)} className="min-w-0 flex-1" />
                    {command.hint && <span className="launcher-item-hint" title={command.hint}>{command.hint}</span>}
                    {command.secondary && <CommandShortcut title={command.secondary.label}>{modifier}↵ {command.secondary.label}</CommandShortcut>}
                  </CommandItem>
                ))}
                {group.hidden > 0 && (
                  <CommandItem
                    value={"more:" + group.name}
                    disabled={running}
                    className="launcher-show-more"
                    onSelect={() => showMore(group)}
                  >
                    Show {group.hidden} more results
                    <span className="sr-only"> in {group.name}</span>
                  </CommandItem>
                )}
              </CommandGroup>
            ))}
          </CommandList>
          {error && <p role="alert" className="launcher-error border-t border-border px-3 py-2 text-xs text-destructive">{error}</p>}
          <div className="launcher-footer" aria-live="polite">
            {selectedCommand?.detail && <div className="launcher-detail" title={selectedCommand.detail}>{selectedCommand.detail}</div>}
            <div className="flex items-center gap-3">
              <span className="min-w-0 truncate">{running ? "Working…" : "↵ " + (selectedAction?.label ?? (moreGroup ? "Show more results" : "Select a result"))}</span>
              {actionTarget ? <span className="shrink-0">esc back</span> : <>
                {selectedCommand?.secondary && <span className="min-w-0 truncate">{modifier}↵ {selectedCommand.secondary.label}</span>}
                {selectedCommand && !selectedCommand.status && <span className="shrink-0">{modifier}. actions</span>}
              </>}
              <span className="ml-auto shrink-0">{actionTarget ? visibleActions.length + " actions" : <>
                <button type="button" className="launcher-sources-toggle" disabled={running} aria-keyshortcuts="Alt+S" aria-expanded={filtersVisible} aria-controls="launcher-source-filters" onClick={() => focusFilters(true)}>{filterShortcut} sources</button>
                <span className="ml-3" title="Recall recent commands">{historyShortcut}</span>
              </>}</span>
            </div>
          </div>
        </CommandRoot>
      )}
    </CommandDialog>
  );
}
