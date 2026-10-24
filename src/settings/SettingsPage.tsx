import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { Input } from "@/components/ui/input";
import { SETTINGS_AREAS, searchSettings, type SettingsAreaId } from "./settingsSearch";
import { confirmSettingsNavigation, useSettingsDraftState } from "./settingsDrafts";
import { flushNativeConfig, retryNativeConfig, useNativeConfigStatus } from "./nativeConfig";
import "./config/config-theme.css";

const PAGES = {
  config: lazy(() => import("./files/GeneralFile").then(m => ({ default: m.GeneralFile }))),
  appearance: lazy(() => import("./files/AppearanceFile").then(m => ({ default: m.AppearanceFile }))),
  models: lazy(() => import("./files/ModelsFile").then(m => ({ default: m.ModelsFile }))),
  agents: lazy(() => import("./files/AgentsFile").then(m => ({ default: m.AgentsFile }))),
  prompts: lazy(() => import("./files/PromptsFile").then(m => ({ default: m.PromptsFile }))),
  mcp: lazy(() => import("./files/McpFile").then(m => ({ default: m.McpFile }))),
  tools: lazy(() => import("./files/ToolsFile").then(m => ({ default: m.ToolsFile }))),
  sync: lazy(() => import("./files/SyncFile").then(m => ({ default: m.SyncFile }))),
  crash: lazy(() => import("./files/CrashFile").then(m => ({ default: m.CrashFile }))),
  manifest: lazy(() => import("./files/ManifestFile").then(m => ({ default: m.ManifestFile }))),
};

export function SettingsPage({ onClose }: { onClose: () => void | Promise<void> }) {
  const [active, setActive] = useState<SettingsAreaId>("config");
  const [search, setSearch] = useState("");
  const [jump, setJump] = useState<{ target: string; request: number } | null>(null);
  const [pageRevision, setPageRevision] = useState(0);
  const [closeError, setCloseError] = useState<string | null>(null);
  const content = useRef<HTMLElement>(null);
  const navigationPending = useRef(false);
  const scrollPositions = useRef<Partial<Record<SettingsAreaId, number>>>({});
  const config = useNativeConfigStatus();
  const drafts = useSettingsDraftState();
  const results = useMemo(() => searchSettings(search), [search]);
  const activeDef = SETTINGS_AREAS.find(area => area.id === active)!;
  const ActiveComponent = PAGES[active];
  const searching = Boolean(search.trim());

  async function openArea(id: SettingsAreaId, target?: string) {
    if (navigationPending.current) return;
    navigationPending.current = true;
    try {
      // Search may target an overview setting while this area shows an entity
      // editor. Returning to the overview must respect its unsaved draft too.
      const resetOverview = id === active && Boolean(target) && !Array.from(content.current?.querySelectorAll<HTMLElement>("[data-setting-key]") ?? []).some(node => node.dataset.settingKey === target);
      if ((id !== active || resetOverview) && !await confirmSettingsNavigation()) return;
      if (content.current) scrollPositions.current[active] = content.current.scrollTop;
      if (resetOverview) setPageRevision(value => value + 1);
      setActive(id);
      setJump(target ? { target, request: Date.now() } : null);
      if (id === active && !target && content.current) content.current.scrollTop = 0;
    } finally { navigationPending.current = false; }
  }

  async function close() {
    if (navigationPending.current) return;
    navigationPending.current = true;
    try {
      if (!await confirmSettingsNavigation()) return;
      await flushNativeConfig();
      await onClose();
    } catch (cause) {
      setCloseError(cause instanceof Error ? cause.message : String(cause));
    } finally { navigationPending.current = false; }
  }

  useEffect(() => {
    const main = content.current;
    if (!main) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let matched: HTMLElement | undefined;
    function reveal(): boolean {
      if (!main || main.querySelector("[data-settings-loading]")) return false;
      if (!jump) { main.scrollTop = scrollPositions.current[active] ?? 0; return true; }
      matched = Array.from(main.querySelectorAll<HTMLElement>("[data-setting-key]")).find(node => node.dataset.settingKey === jump.target);
      if (!matched) return false;
      for (let parent = matched.parentElement; parent && parent !== main; parent = parent.parentElement) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
      }
      matched.classList.add("settings-search-highlight");
      matched.scrollIntoView({ block: "center" });
      (matched.querySelector<HTMLElement>("input, select, textarea, button") ?? matched).focus({ preventScroll: true });
      timer = setTimeout(() => matched?.classList.remove("settings-search-highlight"), 2400);
      return true;
    }
    const observer = new MutationObserver(() => { if (reveal()) observer.disconnect(); });
    if (!reveal()) observer.observe(main, { childList: true, subtree: true });
    return () => { observer.disconnect(); clearTimeout(timer); matched?.classList.remove("settings-search-highlight"); };
  }, [active, jump]);

  const saveLabel = config.phase === "error" ? "Not saved" : config.phase === "loading" ? "Loading…" : config.saving || drafts.some(draft => draft.busy) ? "Saving…" : config.dirty ? "Changes pending" : drafts.length ? "Unsaved draft" : "Saved locally";

  return (
    <div className="settings-shell flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="settings-toolbar">
        <p>Settings</p>
        <span className={`settings-save-status${config.error ? " is-error" : ""}`} role="status">{saveLabel}</span>
        <button type="button" onClick={() => void close()} aria-label="Close settings" className="settings-close"><HugeiconsIcon icon={Cancel01Icon} size={15} strokeWidth={1.75} /></button>
      </header>
      {(config.error || closeError) && <div className="settings-save-error" role="alert"><span>Could not save settings. {config.error || closeError}</span><button type="button" onClick={() => { setCloseError(null); void retryNativeConfig().catch(cause => setCloseError(String(cause))); }}>Retry</button></div>}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="cfgx-sidebar settings-sidebar flex shrink-0 flex-col border-r border-border">
          <div className="p-2.5"><div className="relative">
            <HugeiconsIcon icon={Search01Icon} size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" aria-label="Search settings" placeholder="Search settings…" value={search} onChange={event => setSearch(event.target.value)} className="h-8 rounded border-border bg-muted/30 py-0 pl-7 pr-2 text-xs" />
          </div></div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3" aria-label="Settings areas">
            {searching ? <>
              <p className="cfgx-sidebar-kicker" role="status">{results.length} {results.length === 1 ? "result" : "results"}</p>
              {!results.length && <p className="settings-search-empty">No settings match “{search}”.</p>}
              {results.map(result => <button type="button" key={`${result.area}:${result.target ?? "area"}`} className="cfgx-tree-item settings-search-result" onClick={() => void openArea(result.area, result.target)}><span><span className="block">{result.label}</span><span className="cfgx-tree-detail">{SETTINGS_AREAS.find(area => area.id === result.area)!.label}</span></span></button>)}
            </> : (["Workspace", "AI", "System"] as const).map(group => <section key={group} className="cfgx-nav-group"><p>{group}</p>{SETTINGS_AREAS.filter(area => area.group === group).map(area => <button type="button" key={area.id} className={`cfgx-tree-item${active === area.id ? " active" : ""}`} aria-current={active === area.id ? "page" : undefined} onClick={() => void openArea(area.id)}><span className="cfgx-nav-mark" aria-hidden="true">{area.mark}</span><span className="min-w-0 flex-1"><span className="block">{area.label}</span><span className="cfgx-tree-detail">{area.description}</span></span></button>)}</section>)}
          </nav>
          <div className="cfgx-sidebar-footer"><span className="cfgx-footer-dot" /><span>Make Husk yours</span></div>
        </aside>
        <main ref={content} className="settings-native-content min-w-0 flex-1 overflow-y-auto" aria-label={activeDef.label}>
          <div className="settings-native-frame">
            <div className="settings-native-heading"><p className="settings-page-kicker">HUSK / PREFERENCES</p><h1>{activeDef.label}</h1><p>{activeDef.description}</p></div>
            <div className="settings-native-form"><Suspense fallback={<p data-settings-loading role="status">Loading settings…</p>}><ActiveComponent key={`${active}:${pageRevision}`} /></Suspense></div>
          </div>
        </main>
      </div>
    </div>
  );
}
