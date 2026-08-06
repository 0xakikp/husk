import { useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import { GeneralFile } from "./files/GeneralFile";
import { AppearanceFile } from "./files/AppearanceFile";
import { ProjectFile } from "./files/ProjectFile";
import { ModelsFile } from "./files/ModelsFile";
import { AgentsFile } from "./files/AgentsFile";
import { PromptsFile } from "./files/PromptsFile";
import { McpFile } from "./files/McpFile";
import { ToolsFile } from "./files/ToolsFile";
import { SyncFile } from "./files/SyncFile";
import { CrashFile } from "./files/CrashFile";
import { ManifestFile } from "./files/ManifestFile";
import "./config/config-theme.css";

type FileId =
  | "config"
  | "appearance"
  | "project"
  | "models"
  | "agents"
  | "prompts"
  | "mcp"
  | "tools"
  | "sync"
  | "crash"
  | "manifest";

type FileDef = {
  id: FileId;
  path: string;
  component: ComponentType;
  keywords: string[];
  label: string;
  description: string;
  group: "Workspace" | "AI" | "System";
  mark: string;
};

const FILES: FileDef[] = [
  { id: "config", label: "Workspace", description: "Editor, terminal, and startup", path: "workspace", component: GeneralFile, group: "Workspace", mark: "⌘", keywords: ["general", "editor", "terminal", "font", "cursor", "vim", "startup"] },
  { id: "appearance", label: "Appearance", description: "Theme, wallpaper, and effects", path: "appearance", component: AppearanceFile, group: "Workspace", mark: "◐", keywords: ["appearance", "theme", "wallpaper", "color", "opacity", "blur", "glow", "effects"] },
  { id: "project", label: "Project", description: "What Husk knows about the open folder", path: "project", component: ProjectFile, group: "Workspace", mark: "◈", keywords: ["project", "profile", "husk", "instructions", "runbook", "recipe", "environment"] },
  { id: "models", label: "AI & Models", description: "Default model and provider access", path: "ai-models", component: ModelsFile, group: "AI", mark: "✦", keywords: ["models", "provider", "api", "key", "anthropic", "openai", "claude", "deepseek", "local"] },
  { id: "agents", label: "Agents", description: "Personas and assistant behavior", path: "agents", component: AgentsFile, group: "AI", mark: "◎", keywords: ["agents", "persona", "system", "prompt", "composer"] },
  { id: "prompts", label: "Prompts", description: "Templates and quick actions", path: "prompts", component: PromptsFile, group: "AI", mark: "✎", keywords: ["prompts", "templates", "quick", "actions", "slash"] },
  { id: "mcp", label: "Integrations", description: "MCP servers and tools", path: "integrations", component: McpFile, group: "AI", mark: "⊹", keywords: ["mcp", "server", "tools", "protocol"] },
  { id: "tools", label: "Command tools", description: "CLI tools and setup", path: "command-tools", component: ToolsFile, group: "System", mark: "⌁", keywords: ["tools", "cli", "install", "eza", "bat", "fzf", "setup"] },
  { id: "sync", label: "Cloud & sync", description: "Backup and transfer", path: "sync", component: SyncFile, group: "System", mark: "↔", keywords: ["sync", "cloud", "export", "import", "backup", "transfer"] },
  { id: "crash", label: "Privacy", description: "Crash reports and telemetry", path: "privacy", component: CrashFile, group: "System", mark: "◉", keywords: ["crash", "sentry", "error", "report", "telemetry"] },
  { id: "manifest", label: "About Husk", description: "Version, updates, and support", path: "about", component: ManifestFile, group: "System", mark: "i", keywords: ["manifest", "about", "version", "license", "github", "updates"] },
];

function TreeItem({
  def,
  depth,
  active,
  onSelect,
}: {
  def: FileDef;
  depth: number;
  active: boolean;
  onSelect: (id: FileId) => void;
}) {
  return (
    <button
      type="button"
      className={cn("cfgx-tree-item", active && "active")}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(def.id)}
    >
      <span className="cfgx-nav-mark" aria-hidden="true">{def.mark}</span>
      <span className="min-w-0 flex-1"><span className="block">{def.label}</span><span className="cfgx-tree-detail">{def.description}</span></span>
    </button>
  );
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<FileId>("config");
  const [search, setSearch] = useState("");

  const openFile = (id: FileId) => {
    setActive(id);
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return FILES;
    return FILES.filter(
      (f) => f.path.toLowerCase().includes(q) || f.keywords.some((k) => k.includes(q)),
    );
  }, [search]);

  const searching = search.trim().length > 0;
  const activeDef = FILES.find((file) => file.id === active) ?? FILES[0];
  const ActiveComponent = activeDef.component;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground select-none">
      <div className="flex h-9 shrink-0 items-center border-b border-border bg-background px-4">
        <p className="m-0 text-[13px] font-semibold leading-none">Settings</p>
        <div className="flex-1" />
        <div className="flex items-center">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="cfgx-sidebar flex w-56 shrink-0 flex-col border-r border-border">
          <div className="p-2.5">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                size={12}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50"
              />
              <Input
                placeholder="Search settings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 rounded border-border/40 bg-muted/40 py-0 pl-7 pr-2 font-mono text-[11px]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-1.5 pb-3">
            <div className="cfgx-sidebar-kicker">Settings</div>

            {searching ? (
              visible.length === 0 ? (
                <div className="px-2 py-3 text-[10px] text-muted-foreground/60">
                  no matches for “{search}”
                </div>
              ) : (
                <div className="cfgx-search-results">{visible.map((def) => <TreeItem key={def.id} def={def} depth={0} active={def.id === active} onSelect={openFile} />)}</div>
              )
            ) : (
              (["Workspace", "AI", "System"] as const).map((group) => (
                <section key={group} className="cfgx-nav-group">
                  <p>{group}</p>
                  {FILES.filter((def) => def.group === group).map((def) => <TreeItem key={def.id} def={def} depth={0} active={def.id === active} onSelect={openFile} />)}
                </section>
              ))
            )}
          </div>

          <div className="cfgx-sidebar-footer">
            <span className="cfgx-footer-dot" />
            <span>{FILES.length} settings areas</span>
          </div>
        </aside>

        <main className="settings-native-content min-w-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="settings-native-frame">
            <div className="settings-native-heading">
              <h1>{activeDef.label}</h1>
              <p>{activeDef.description}</p>
            </div>
            <div className="settings-native-form"><ActiveComponent /></div>
          </div>
        </main>
      </div>
    </div>
  );
}
