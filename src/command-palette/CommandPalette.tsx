import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  /** Non-interactive status row: implies alwaysShow, and is skipped by keyboard
   *  navigation since cmdk's getValidItems excludes aria-disabled items. */
  status?: boolean;
  run: () => void;
};

const GROUP_ORDER = [
  "Notes",
  "Files",
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
  "Ask AI",
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

/* Prefixes scope the search to one source. "> x" commands, "n " notes,
   "f " files, "w " workflows, "d " docker, "k " k8s, "r " remotes, "j " jobs,
   "c " clipboard, "b " bookmarks, "g " grep (file contents). */
const PREFIX_KIND: Record<string, LauncherKind> = {
  ">": "command",
  n: "note",
  f: "file",
  w: "workflow",
  d: "container",
  k: "k8s",
  r: "remote",
  j: "job",
  c: "clipboard",
  b: "bookmark",
  g: "grep",
};

export function parseQuery(raw: string): { kind: LauncherKind | null; query: string } {
  if (raw.startsWith(">")) return { kind: "command", query: raw.slice(1).trimStart() };
  const m = raw.match(/^([nfwdkrjcbg])\s+(.*)$/);
  if (m && PREFIX_KIND[m[1]]) return { kind: PREFIX_KIND[m[1]], query: m[2] };
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
  const [internalInput, setInternalInput] = useState("");
  const rawInput = inputValue ?? internalInput;
  const setRawInput = (v: string) => {
    setInternalInput(v);
    onInputChange?.(v);
  };
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

  // The palette is lazy-loaded behind Suspense and Radix's focus scope also
  // claims focus on mount, so `autoFocus` alone can lose the race. Take focus on
  // the next frame so Cmd+K always lands the caret in the search field.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

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

  const sortedGroups = useMemo(() => {
    return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({
      name: g,
      items: groups.get(g)!,
    }));
  }, [groups]);

  const showEmpty = sortedGroups.length === 0 && rawInput.trim().length > 0;

  const handleSelect = (cmd: Command) => {
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
        />
        <CommandList>
          {showEmpty && !actionTarget && <CommandEmpty>No results found.</CommandEmpty>}
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
            </CommandGroup>
          ))}
        </CommandList>
        <div className="flex items-center gap-3 border-t border-border/50 px-3 py-1.5 text-[9.5px] text-muted-foreground/50">
          <span>↵ open</span>
          <span>⌘↵ action</span>
          <span>{actionTarget ? "esc back" : "⌘. actions"}</span>
          <span className="ml-auto">&gt; cmd · n notes · f files · g grep · b bookmarks · c clipboard · w workflows · d docker · k k8s · r remotes · j jobs</span>
        </div>
      </CommandRoot>
    </CommandDialog>
  );
}
