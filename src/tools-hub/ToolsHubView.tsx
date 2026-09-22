import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, MoreHorizontalIcon, PuzzleIcon, SecurityCheckIcon, ComputerTerminal02Icon, CodeIcon } from "@hugeicons/core-free-icons";
import { SiKubernetes, SiDocker, SiTailscale } from "@icons-pack/react-simple-icons";
import { usePrefs, setPrefs } from "../settings/preferences";
import { loadPlugins, type LoadedPlugin } from "../plugins/loader";
import { PluginPanel } from "../plugins/PluginPanel";
import type { Plugin } from "../plugins/types";
import type { SidebarViewId } from "../sidebar/SidebarRail";
import { PanelHeader } from "../shell/PanelHeader";
import { PortsView } from "../ports/PortsView";
import { DevToolsView } from "../dev-tools/DevToolsView";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import "./ToolsHubView.css";

const TOOLS = [
  { id: "kubernetes", bin: "kubectl", name: "Kubernetes", description: "Contexts, workloads, and logs", Icon: SiKubernetes, brand: "#326CE5" },
  { id: "docker", bin: "docker", name: "Docker", description: "Containers, images, and logs", Icon: SiDocker, brand: "#2496ED" },
  { id: "tailscale", bin: null, name: "Tailscale", description: "Tailnet devices and SSH connections", Icon: SiTailscale, brand: "currentColor" },
] as const;

function ToolRow({ name, description, icon, onClick, status, detail }: {
  name: string; description: string; icon: ReactNode; onClick: () => void; status?: string; detail?: string;
}) {
  return <Tooltip>
    <TooltipTrigger asChild><button type="button" className="tools-hub-row" onClick={onClick}>
      <span className="tools-hub-icon" aria-hidden="true">{icon}</span>
      <span className="tools-hub-row-title">{name}</span>
      {status && <span className="tools-hub-row-status">{status}</span>}
    </button></TooltipTrigger>
    <TooltipContent side="right" sideOffset={8} className="tools-hub-tooltip rounded-md border border-border bg-popover text-popover-foreground">
      <span>{description}{detail && <span className="tools-hub-tooltip-detail">{detail}</span>}</span>
    </TooltipContent>
  </Tooltip>;
}

type Props = {
  active?: boolean;
  onSelectView: (view: SidebarViewId) => void;
  onTypeCommand: (cmd: string) => void;
  onOpenTotp: () => void;
  onOpenBrowser: (url: string) => void;
};

export function ToolsHubView({ active = true, onSelectView, onTypeCommand, onOpenTotp, onOpenBrowser }: Props) {
  const dir = usePrefs().pluginsDir;
  const [catalog, setCatalog] = useState<{ dir: string; loaded: LoadedPlugin[]; error: string | null; loading: boolean }>({ dir: "", loaded: [], error: null, loading: false });
  const [selected, setSelected] = useState<{ plugin: Plugin; dir: string } | null>(null);
  const [utility, setUtility] = useState<"ports" | "dev-tools" | null>(null);
  const [managing, setManaging] = useState(false);
  const [revision, setRevision] = useState(0);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installed, setInstalled] = useState<Set<string> | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    let current = true;
    setSelected(null);
    setCatalog({ dir, loaded: [], error: null, loading: !!dir });
    if (dir) void loadPlugins(dir).then(
      (loaded) => { if (current) setCatalog({ dir, loaded, error: null, loading: false }); },
      (reason) => { if (current) setCatalog({ dir, loaded: [], error: String(reason), loading: false }); },
    );
    return () => { current = false; };
  }, [dir, revision]);

  const pickDir = useCallback(async () => {
    setPicking(true); setFolderError(null);
    try {
      const chosen = await openDialog({ directory: true, multiple: false, title: "Choose custom plugin folder" });
      if (alive.current && typeof chosen === "string") setPrefs({ pluginsDir: chosen });
    } catch (reason) {
      if (alive.current) setFolderError(String(reason));
    } finally { if (alive.current) setPicking(false); }
  }, []);

  const checkTools = async () => {
    if (checking) return;
    setChecking(true); setCheckError(null); setInstalled(null);
    try {
      const bins = await invoke<string[]>("detect_binaries", { bins: TOOLS.flatMap((tool) => tool.bin ? [tool.bin] : []) });
      if (alive.current) setInstalled(new Set(bins));
    } catch (reason) {
      if (alive.current) setCheckError("Could not check local CLIs: " + String(reason));
    } finally { if (alive.current) setChecking(false); }
  };

  if (selected?.dir === dir) {
    return <PluginPanel plugin={selected.plugin} active={active} onBack={() => setSelected(null)} />;
  }
  if (utility === "ports") return <PortsView onBack={() => setUtility(null)} onTypeCommand={onTypeCommand} onOpenBrowser={onOpenBrowser} />;
  if (utility === "dev-tools") return <DevToolsView onBack={() => setUtility(null)} />;

  const currentCatalog = catalog.dir === dir ? catalog : { loaded: [], loading: !!dir, error: null };
  const validCount = currentCatalog.loaded.filter((entry) => "plugin" in entry).length;
  const invalidCount = currentCatalog.loaded.length - validCount;
  const pluginRows = currentCatalog.loaded.flatMap((entry, index) => "plugin" in entry ? [
    <ToolRow key={entry.plugin.id + ":" + index} name={entry.plugin.name} description={entry.plugin.description || entry.plugin.views.length + " views"}
      detail="Custom tool · review its command before running."
      icon={<HugeiconsIcon icon={PuzzleIcon} size={14} style={{ color: entry.plugin.brand }} />}
      onClick={() => { setManaging(false); setSelected({ plugin: entry.plugin, dir }); }} />,
  ] : []);

  if (managing) return <TooltipProvider delayDuration={350}>
    <div className="tools-hub">
      <PanelHeader icon={PuzzleIcon} title="Custom plugins" actions={
        <button type="button" aria-label="Back to tools" title="Back to tools" className="tools-hub-menu-button" onClick={() => setManaging(false)}>
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
        </button>
      } />
      <div className="tools-hub-content tools-hub-manager">
        <p className="tools-hub-help">Load local JSON definitions. Only run commands from authors you trust; Husk asks before running a view.</p>
        <div className="tools-hub-management-actions">
          <button type="button" className="tools-hub-text-button" disabled={picking} onClick={() => void pickDir()}>{picking ? "Choosing…" : dir ? "Change folder" : "Choose folder"}</button>
          {dir && <button type="button" className="tools-hub-text-button" disabled={currentCatalog.loading || picking} onClick={() => setRevision((value) => value + 1)}>Reload plugins</button>}
        </div>
        {dir && <p className="tools-hub-folder">{dir}</p>}
        {folderError && <p role="alert" className="tools-hub-error">Could not choose folder: {folderError}</p>}
        {!dir ? <p className="tools-hub-empty">No folder selected. Built-in tools work without plugins.</p>
          : currentCatalog.loading ? <p role="status" className="tools-hub-empty">Loading plugin definitions…</p>
          : currentCatalog.error ? <div role="alert" className="tools-hub-error">Could not read plugin folder: {currentCatalog.error}<br /><button type="button" className="tools-hub-text-button" onClick={() => setRevision((value) => value + 1)}>Retry</button></div>
          : currentCatalog.loaded.length === 0 ? <p className="tools-hub-empty">No .json plugin files in this folder.</p>
          : <section aria-label="Plugin definitions">
            {pluginRows}
            {currentCatalog.loaded.map((entry, index) => "error" in entry && <div key={entry.id + ":" + index} className="tools-hub-error" role="alert"><strong>{entry.id}</strong><br />{entry.error}</div>)}
          </section>}
        {dir && <div className="tools-hub-disconnect">
          <button type="button" className="tools-hub-text-button" disabled={picking} onClick={() => { setPrefs({ pluginsDir: "" }); setFolderError(null); }}>Clear folder selection</button>
          <p className="tools-hub-help">Removes the folder from Husk. Files on disk are not deleted.</p>
        </div>}
      </div>
    </div>
  </TooltipProvider>;

  return (
    <TooltipProvider delayDuration={350}><div className="tools-hub">
      <PanelHeader icon={PuzzleIcon} title="Tools" status={checking ? <span className="tools-hub-checking" role="status">Checking CLIs…</span> : undefined} actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Tools options" className="tools-hub-menu-button">
              <HugeiconsIcon icon={MoreHorizontalIcon} size={15} strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border border-border">
            <DropdownMenuItem disabled={checking} onSelect={() => void checkTools()} className="rounded-md px-2 py-1.5 text-[11px]">{checking ? "Checking CLIs…" : "Check CLIs"}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setManaging(true)} className="rounded-md px-2 py-1.5 text-[11px]">Manage custom plugins…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      } />
      <div className="tools-hub-content">
        <section aria-labelledby="tools-utilities-heading">
          <h3 id="tools-utilities-heading">Utilities</h3>
          <ToolRow name="2FA Codes" description="Generate locally stored time-based codes" icon={<HugeiconsIcon icon={SecurityCheckIcon} size={14} />} onClick={onOpenTotp} />
          <ToolRow name="Ports" description="Local listeners and development servers" icon={<HugeiconsIcon icon={ComputerTerminal02Icon} size={14} />} onClick={() => setUtility("ports")} />
          <ToolRow name="Dev Tools" description="Format, decode, convert, and generate locally" icon={<HugeiconsIcon icon={CodeIcon} size={14} />} onClick={() => setUtility("dev-tools")} />
        </section>
        <section aria-labelledby="tools-infrastructure-heading">
          <h3 id="tools-infrastructure-heading">Infrastructure</h3>
          {checkError && <p className="tools-hub-error" role="alert">{checkError}</p>}
          {TOOLS.map(({ Icon, ...tool }) => <ToolRow key={tool.id} name={tool.name} description={tool.description}
            icon={<Icon size={14} color={tool.brand} />} onClick={() => onSelectView(tool.id)}
            status={tool.bin && installed && !installed.has(tool.bin) ? "Unavailable" : undefined}
            detail={!tool.bin ? "Uses the API connection configured in Tailscale." : installed
              ? installed.has(tool.bin) ? "Local CLI found; service connection not checked." : tool.bin + " was not found locally. Install it, then check CLIs again."
              : "Uses local CLI configuration, not the active SSH terminal."} />)}
          <span className="sr-only" role="status">{installed && (TOOLS.filter((tool) => tool.bin && !installed.has(tool.bin)).map((tool) => tool.name).join(", ") || "No") + " local CLIs missing. Service connections were not checked."}</span>
        </section>
        {dir && (currentCatalog.loading || currentCatalog.error || currentCatalog.loaded.length > 0) && <section aria-labelledby="tools-custom-heading">
          <h3 id="tools-custom-heading">Custom plugins</h3>
          {currentCatalog.loading ? <p role="status" className="tools-hub-help">Loading plugins…</p> : pluginRows}
          {(currentCatalog.error || invalidCount > 0) && <ToolRow name="Plugin setup" description="Review plugin loading errors and retry in Manage custom plugins."
            status="Needs attention" icon={<HugeiconsIcon icon={PuzzleIcon} size={14} />} onClick={() => setManaging(true)} />}
        </section>}
      </div>
    </div></TooltipProvider>
  );
}
