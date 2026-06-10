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
  SourceCodeIcon,
  PlayIcon,
  FolderCloudIcon,
  CommandIcon,
  DownloadCircle01Icon,
} from "@hugeicons/core-free-icons";
import { recordCommandUse, getFrecencyScore, getCommandHistory } from "./history";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  group?: string;
  run: () => void;
};

const GROUP_ORDER = ["General", "View", "AI", "Tools", "Git", "Other"];

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
  snippets: SourceCodeIcon,
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
  "sidebar-docker": DatabaseIcon,
  aws: CloudIcon,
  "open-file": File01Icon,
  "new-tab": PlusSignIcon,
  "run-workflow": PlayIcon,
  "open-snippets": SourceCodeIcon,
  "open-clipboard": ClipboardIcon,
  "open-totp": SecurityCheckIcon,
  "check-updates": DownloadCircle01Icon,
  "open-jobs": TimeScheduleIcon,
  "open-authenticator": SecurityCheckIcon,
};

function getIcon(id: string): typeof Search01Icon {
  if (ICON_MAP[id]) return ICON_MAP[id];
  for (const [key, icon] of Object.entries(ICON_MAP)) {
    if (id.includes(key)) return icon;
  }
  return CommandIcon;
}

function getGroup(id: string, label: string): string {
  const lower = `${id} ${label}`.toLowerCase();
  if (lower.includes("ai") || lower.includes("suggest") || lower.includes("explain")) return "AI";
  if (lower.includes("docker") || lower.includes("k8s") || lower.includes("kubernetes") || lower.includes("terraform") || lower.includes("remotes") || lower.includes("github") || lower.includes("cicd") || lower.includes("aws")) return "Tools";
  if (lower.includes("git") || lower.includes("diff")) return "Git";
  if (lower.includes("explorer") || lower.includes("sidebar") || lower.includes("folder") || lower.includes("file") || lower.includes("zoom")) return "View";
  if (lower.includes("settings") || lower.includes("workflows") || lower.includes("authenticator") || lower.includes("integrations") || lower.includes("install") || lower.includes("jobs") || lower.includes("totp") || lower.includes("snippets") || lower.includes("clipboard") || lower.includes("terminal") || lower.includes("tab")) return "General";
  return "Other";
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
  const [query, setQuery] = useState("");
  const historyIndexRef = useRef(-1);
  const historyRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      document.body.style.pointerEvents = "";
    };
  }, []);

  // Reset history index when query changes manually
  useEffect(() => {
    historyIndexRef.current = -1;
  }, [query]);

  const enriched = useMemo(() => {
    const list = commands.map((c) => ({
      ...c,
      group: c.group || getGroup(c.id, c.label),
      score: getFrecencyScore(c.id),
    }));
    // Sort by frecency when no query; keep stable order otherwise (cmdk filters)
    if (!query.trim()) {
      list.sort((a, b) => b.score - a.score);
    }
    return list;
  }, [commands, query]);

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

  const showEmpty = query.trim().length > 0 && sortedGroups.length === 0;

  const handleSelect = (cmd: Command) => {
    recordCommandUse(cmd.id);
    cmd.run();
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowUp") {
      // Cycle through command history when input is at top of list
      e.preventDefault();
      if (historyIndexRef.current === -1) {
        historyRef.current = getCommandHistory();
      }
      const hist = historyRef.current;
      if (hist.length === 0) return;
      historyIndexRef.current = Math.min(historyIndexRef.current + 1, hist.length - 1);
      const id = hist[historyIndexRef.current];
      const cmd = commands.find((c) => c.id === id);
      if (cmd) setQuery(cmd.label);
    } else if (e.key === "ArrowDown" && historyIndexRef.current >= 0) {
      e.preventDefault();
      historyIndexRef.current = Math.max(historyIndexRef.current - 1, -1);
      if (historyIndexRef.current === -1) {
        setQuery("");
      } else {
        const id = historyRef.current[historyIndexRef.current];
        const cmd = commands.find((c) => c.id === id);
        if (cmd) setQuery(cmd.label);
      }
    }
  };

  return (
    <CommandDialog
      open={open}
      className="sm:max-w-[420px]"
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <CommandRoot>
        <CommandInput
          autoFocus
          placeholder="Search commands, files, or actions..."
          value={query}
          onValueChange={setQuery}
          onKeyDown={handleKeyDown}
        />
        <CommandList>
          {showEmpty && <CommandEmpty>No results found.</CommandEmpty>}

          {sortedGroups.map((group) => (
            <CommandGroup key={group.name} heading={group.name}>
              {group.items.map((cmd) => {
                const Icon = getIcon(cmd.id);
                return (
                  <CommandItem
                    key={cmd.id}
                    value={`${cmd.label} ${cmd.id}`}
                    onSelect={() => handleSelect(cmd)}
                  >
                    <div className="flex size-5 shrink-0 items-center justify-center">
                      <HugeiconsIcon
                        icon={Icon}
                        size={15}
                        strokeWidth={1.5}
                        className="text-muted-foreground"
                      />
                    </div>
                    <span className="min-w-0 flex-1 truncate">{cmd.label}</span>
                    {cmd.hint ? (
                      <CommandShortcut>{cmd.hint}</CommandShortcut>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandRoot>
    </CommandDialog>
  );
}
