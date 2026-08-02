import { useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Input } from "@/components/ui/input";
import { GeneralFile } from "./files/GeneralFile";
import { AppearanceFile } from "./files/AppearanceFile";
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
  dir?: "ai";
  component: ComponentType;
  keywords: string[];
};

const FILES: FileDef[] = [
  { id: "config", path: "config.toml", component: GeneralFile, keywords: ["general", "editor", "terminal", "font", "cursor", "vim", "startup"] },
  { id: "appearance", path: "appearance.toml", component: AppearanceFile, keywords: ["appearance", "theme", "wallpaper", "color", "opacity", "blur", "glow", "effects"] },
  { id: "models", path: "ai/models.toml", dir: "ai", component: ModelsFile, keywords: ["models", "provider", "api", "key", "anthropic", "openai", "claude", "deepseek", "local"] },
  { id: "agents", path: "ai/agents.toml", dir: "ai", component: AgentsFile, keywords: ["agents", "persona", "system", "prompt", "composer"] },
  { id: "prompts", path: "ai/prompts.toml", dir: "ai", component: PromptsFile, keywords: ["prompts", "templates", "quick", "actions", "slash"] },
  { id: "mcp", path: "mcp.toml", component: McpFile, keywords: ["mcp", "server", "tools", "protocol"] },
  { id: "tools", path: "tools.toml", component: ToolsFile, keywords: ["tools", "cli", "install", "eza", "bat", "fzf", "setup"] },
  { id: "sync", path: "sync.toml", component: SyncFile, keywords: ["sync", "cloud", "export", "import", "backup", "transfer"] },
  { id: "crash", path: "crash.toml", component: CrashFile, keywords: ["crash", "sentry", "error", "report", "telemetry"] },
  { id: "manifest", path: "manifest.toml", component: ManifestFile, keywords: ["manifest", "about", "version", "license", "github", "updates"] },
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
  const name = def.path.split("/").pop() ?? def.path;
  return (
    <button
      type="button"
      className={cn("cfgx-tree-item", active && "active")}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => onSelect(def.id)}
    >
      <span className="text-muted-foreground/50">{name.endsWith(".toml") ? "◦" : "▸"}</span>
      <span>{name}</span>
    </button>
  );
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<FileId>("config");
  const [open, setOpen] = useState<FileId[]>(["config"]);
  const [search, setSearch] = useState("");

  const openFile = (id: FileId) => {
    setOpen((o) => (o.includes(id) ? o : [...o, id]));
    setActive(id);
  };

  const closeTab = (id: FileId) => {
    setOpen((o) => {
      const next = o.filter((f) => f !== id);
      if (id === active) {
        setActive(next[next.length - 1] ?? FILES[0].id);
        if (next.length === 0) return [FILES[0].id];
      }
      return next.length === 0 ? [FILES[0].id] : next;
    });
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return FILES;
    return FILES.filter(
      (f) => f.path.toLowerCase().includes(q) || f.keywords.some((k) => k.includes(q)),
    );
  }, [search]);

  const visibleIds = useMemo(() => new Set(visible.map((f) => f.id)), [visible]);
  const searching = search.trim().length > 0;
  const activeDef = FILES.find((f) => f.id === active) ?? FILES[0];
  const ActiveComponent = activeDef.component;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground select-none">
      {/* ── Tab bar ── */}
      <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-muted/20 font-mono">
        <div className="flex items-stretch overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {open.map((id) => {
            const def = FILES.find((f) => f.id === id);
            if (!def) return null;
            return (
              <button
                key={id}
                type="button"
                className={cn("cfgx-tab", id === active && "active")}
                onClick={() => setActive(id)}
              >
                <span>{def.path.split("/").pop()}</span>
                {open.length > 1 ? (
                  <span
                    role="button"
                    tabIndex={-1}
                    className="cfgx-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(id);
                    }}
                  >
                    ✕
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 px-3">
          <span className="text-[10px] text-muted-foreground/50">~/.husk/{activeDef.path}</span>
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
        {/* ── Explorer ── */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-border bg-muted/10 font-mono">
          <div className="p-2.5">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                size={12}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50"
              />
              <Input
                placeholder="grep settings…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-7 rounded border-border/40 bg-muted/40 py-0 pl-7 pr-2 font-mono text-[11px]"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-1.5 pb-3">
            <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-muted-foreground/40">
              ~/.husk
            </div>

            {searching ? (
              visible.length === 0 ? (
                <div className="px-2 py-3 text-[10px] text-muted-foreground/60">
                  no matches for “{search}”
                </div>
              ) : (
                visible.map((def) => (
                  <TreeItem key={def.id} def={def} depth={def.dir === "ai" ? 1 : 0} active={def.id === active} onSelect={openFile} />
                ))
              )
            ) : (
              <>
                {FILES.filter((f) => !f.dir && (f.id === "config" || f.id === "appearance")).map((def) => (
                  <TreeItem key={def.id} def={def} depth={0} active={def.id === active} onSelect={openFile} />
                ))}

                <div className="px-2 py-0.5 text-[11px] text-muted-foreground/70">▾ ai/</div>
                {FILES.filter((f) => f.dir === "ai").map((def) => (
                  visibleIds.has(def.id) ? (
                    <TreeItem key={def.id} def={def} depth={1} active={def.id === active} onSelect={openFile} />
                  ) : null
                ))}

                {FILES.filter((f) => !f.dir && f.id !== "config" && f.id !== "appearance").map((def) => (
                  <TreeItem key={def.id} def={def} depth={0} active={def.id === active} onSelect={openFile} />
                ))}
              </>
            )}
          </div>

          <div className="border-t border-border px-3 py-2 text-[9px] text-muted-foreground/50">
            utf-8 · toml · {FILES.length} files
          </div>
        </aside>

        {/* ── Editor ── */}
        <main className="min-w-0 flex-1 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <ActiveComponent />
        </main>
      </div>
    </div>
  );
}
