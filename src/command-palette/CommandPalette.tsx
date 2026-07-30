import { useEffect, useMemo, useRef, useState } from "react";
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
  | "remote";

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
  run: () => void;
};

const GROUP_ORDER = [
  "Notes",
  "Files",
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
};

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
   "f " files, "w " workflows, "d " docker, "k " k8s, "r " remotes, "j " jobs. */
const PREFIX_KIND: Record<string, LauncherKind> = {
  ">": "command",
  n: "note",
  f: "file",
  w: "workflow",
  d: "container",
  k: "k8s",
  r: "remote",
  j: "job",
};

function parseQuery(raw: string): { kind: LauncherKind | null; query: string } {
  if (raw.startsWith(">")) return { kind: "command", query: raw.slice(1).trimStart() };
  const m = raw.match(/^([nfwdkrj])\s+(.*)$/);
  if (m && PREFIX_KIND[m[1]]) return { kind: PREFIX_KIND[m[1]], query: m[2] };
  return { kind: null, query: raw };
}

/** Small scoring fn used as cmdk filter. Returns 0 to hide, higher = better. */
function scoreValue(value: string, query: string): number {
  if (!query) return 1;
  const v = value.toLowerCase();
  const q = query.toLowerCase();
  if (v.includes(q)) {
    const label = value.split(" ")[0]?.toLowerCase() ?? v;
    if (label.startsWith(q)) return 2;
    return 1;
  }
  // Subsequence match (fuzzy)
  let qi = 0;
  for (let i = 0; i < v.length && qi < q.length; i++) {
    if (v[i] === q[qi]) qi++;
  }
  return qi === q.length ? 0.4 : 0;
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: {
  open: boolean;
  commands: Command[];
  onClose: () => void;
}) {
  const [rawInput, setRawInput] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const historyIndexRef = useRef(-1);
  const historyRef = useRef<string[]>([]);

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

  const { kind: scopedKind, query } = useMemo(() => parseQuery(rawInput), [rawInput]);

  const enriched = useMemo(() => {
    const list = commands
      .filter((c) => !scopedKind || (c.kind ?? "command") === scopedKind)
      .map((c) => ({
        ...c,
        group: c.group || getGroup(c.id, c.label),
        score: getFrecencyScore(c.id),
      }));
    if (!query.trim()) {
      list.sort((a, b) => b.score - a.score);
    }
    return list;
  }, [commands, query, scopedKind]);

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

  const handleSecondary = () => {
    const cmd = commands.find((c) => `${c.label} ${c.id}` === selectedValue || c.id === selectedValue);
    if (cmd?.secondary) {
      recordCommandUse(cmd.id);
      cmd.secondary.run();
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSecondary();
      return;
    }
    if (e.key === "ArrowUp") {
      // Only hijack history when the input is empty and no query results
      if (rawInput) return;
      e.preventDefault();
      if (historyIndexRef.current === -1) {
        historyRef.current = getCommandHistory();
      }
      const hist = historyRef.current;
      if (hist.length === 0) return;
      historyIndexRef.current = Math.min(historyIndexRef.current + 1, hist.length - 1);
      const id = hist[hist.length - 1 - historyIndexRef.current];
      const cmd = commands.find((c) => c.id === id);
      if (cmd) setRawInput(cmd.label);
    } else if (e.key === "ArrowDown" && historyIndexRef.current >= 0) {
      e.preventDefault();
      historyIndexRef.current = Math.max(historyIndexRef.current - 1, -1);
      if (historyIndexRef.current === -1) {
        setRawInput("");
      } else {
        const hist = historyRef.current;
        const id = hist[hist.length - 1 - historyIndexRef.current];
        const cmd = commands.find((c) => c.id === id);
        if (cmd) setRawInput(cmd.label);
      }
    }
  };

  return (
    <CommandDialog
      open={open}
      className="sm:max-w-[520px]"
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <CommandRoot
        value={selectedValue}
        onValueChange={setSelectedValue}
        filter={(value, search) => scoreValue(value, parseQuery(search).query)}
      >
        <CommandInput
          autoFocus
          placeholder="Search everything — notes, files, docker, k8s, workflows…"
          value={rawInput}
          onValueChange={setRawInput}
          onKeyDown={handleKeyDown}
        />
        <CommandList>
          {showEmpty && <CommandEmpty>No results found.</CommandEmpty>}

          {sortedGroups.map((group) => (
            <CommandGroup key={group.name} heading={group.name}>
              {group.items.map((cmd) => {
                const kind = cmd.kind ?? "command";
                const Icon = getIcon(cmd.id, kind);
                const meta = KIND_META[kind];
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`${cmd.label} ${cmd.id}`}
                    keywords={[cmd.id, cmd.keywords ?? "", cmd.group ?? ""]}
                    onSelect={() => handleSelect(cmd)}
                  >
                    <div className={cn("flex size-5 shrink-0 items-center justify-center rounded", meta.className)}>
                      <HugeiconsIcon icon={Icon} size={13} strokeWidth={1.5} />
                    </div>
                    <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
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
          <span className="ml-auto">&gt; cmd · n notes · f files · w workflows · d docker · k k8s · r remotes · j jobs</span>
        </div>
      </CommandRoot>
    </CommandDialog>
  );
}
