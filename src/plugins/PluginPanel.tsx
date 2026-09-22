import { useCallback, useEffect, useId, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, PuzzleIcon } from "@hugeicons/core-free-icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { PanelHeader } from "../shell/PanelHeader";
import { useWorkspaceRoot } from "../workspace/store";
import { getActiveTerminalLeafId } from "../terminal/registry";
import { captureScreenCommandTarget, stageScreenCommand, type ScreenCommandTarget } from "../terminal/stageScreenCommand";
import { runView, type PluginRows } from "./loader";
import { buildPluginActionCommand, type Plugin, type PluginAction } from "./types";
import "./PluginPanel.css";

type ActionPreview = { label: string; command: string; cwd: string; leafId: number | null; target: ScreenCommandTarget | null; targetError: string };
type ViewState = { scope: string; authorized: boolean; autoRefresh: boolean; data: PluginRows | null; error: string; stale: boolean; updatedAt: number | null; openRow: number | null; preview: ActionPreview | null };
const emptyView = (scope: string): ViewState => ({ scope, authorized: false, autoRefresh: false, data: null, error: "", stale: false, updatedAt: null, openRow: null, preview: null });

/** Custom views run only after explicit scope-bound consent. Declarative JSON
 * is not a permission boundary: even the initial command may mutate data. */
export function PluginPanel({ plugin, onBack, active = true }: {
  plugin: Plugin; onBack: () => void; active?: boolean;
  /** Legacy callbacks are deliberately never used by custom actions. */
  onTypeCommand?: (cmd: string) => void; onRunCommand?: (cmd: string) => void;
}) {
  const cwd = useWorkspaceRoot();
  const [viewIndex, setViewIndex] = useState(0);
  const index = Math.min(viewIndex, Math.max(0, plugin.views.length - 1));
  const view = plugin.views[index];
  // Changed file contents revoke consent even when the plugin ID is unchanged.
  const scope = JSON.stringify([plugin, index, cwd]);
  const [state, setState] = useState<ViewState>(() => emptyView(scope));
  const current = state.scope === scope ? state : emptyView(scope);
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [staging, setStaging] = useState(false);
  const [actionNotice, setActionNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const mounted = useRef(false);
  const currentScope = useRef(scope); currentScope.current = scope;
  const canRun = useRef(active && visible); canRun.current = active && visible;
  const pending = useRef<{ scope: string; controller: AbortController } | null>(null);
  const panelId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.controller.abort(); };
  }, []);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    pending.current?.controller.abort();
    setState(emptyView(scope)); setActionNotice(""); setActionError("");
    setStopping(Boolean(pending.current));
  }, [scope]);
  useEffect(() => {
    if (active && visible) return;
    if (pending.current) { pending.current.controller.abort(); setStopping(true); }
    setState((previous) => ({ ...previous, preview: null, openRow: null, stale: Boolean(previous.data), error: previous.data ? "Paused while this tool was hidden. Refresh before using its actions." : previous.error }));
  }, [active, visible]);

  const refresh = useCallback(async (authorize = false) => {
    if (!view || !cwd || !canRun.current || pending.current || (!authorize && !current.authorized)) return;
    const request = { scope, controller: new AbortController() };
    pending.current = request; setBusy(true); setStopping(false); setActionNotice(""); setActionError("");
    setState((previous) => ({ ...(previous.scope === scope ? previous : emptyView(scope)), authorized: true, error: "", openRow: null, preview: null }));
    try {
      const result = await runView(view, cwd, { signal: request.controller.signal });
      if (!mounted.current || request.controller.signal.aborted || currentScope.current !== scope || !canRun.current) return;
      setState((previous) => {
        if (previous.scope !== scope) return previous;
        if (result.error || result.status === "cancelled" || result.status === "timed-out") return { ...previous, error: result.error || result.notice || "The custom command did not finish.", stale: Boolean(previous.data), openRow: null, preview: null };
        return { ...previous, data: result, error: "", stale: Boolean(result.truncated || result.status === "truncated"), updatedAt: Date.now(), openRow: null, preview: null };
      });
    } catch (reason) {
      if (mounted.current && !request.controller.signal.aborted && currentScope.current === scope) setState((previous) => ({ ...previous, stale: Boolean(previous.data), error: reason instanceof Error ? reason.message : "Could not run this custom command.", openRow: null, preview: null }));
    } finally {
      if (pending.current === request) {
        pending.current = null;
        if (mounted.current) { setBusy(false); setStopping(false); }
      }
    }
  }, [scope, cwd, view, current.authorized]);
  useEffect(() => {
    if (!active || !visible || !current.authorized || !current.autoRefresh || !view?.refresh || current.preview) return;
    const timer = window.setInterval(() => { void refresh(); }, view.refresh * 1000);
    return () => window.clearInterval(timer);
  }, [active, visible, current.authorized, current.autoRefresh, current.preview, view?.refresh, refresh]);

  const stop = () => {
    pending.current?.controller.abort(); setStopping(Boolean(pending.current));
    setState((previous) => ({ ...previous, autoRefresh: false, stale: Boolean(previous.data), error: "Results cancelled. The local command may continue until its 20-second timeout. Wait for it to settle before running again.", preview: null }));
  };
  const actionsDisabled = !active || !visible || busy || current.stale || Boolean(current.error) || !current.data;
  const previewAction = (action: PluginAction, row: Record<string, string>) => {
    if (actionsDisabled) return;
    setActionError(""); setActionNotice("");
    try {
      const command = buildPluginActionCommand(action, row);
      const leafId = getActiveTerminalLeafId();
      const target = leafId == null ? null : captureScreenCommandTarget(leafId);
      const targetError = !target ? "No verified local terminal is available. Focus a local shell in this directory, then review the action again."
        : target.isRemote || target.host !== null ? "This view ran locally. Its actions cannot be staged into an SSH terminal."
        : target.cwd !== cwd ? "The terminal folder differs from this local view. Open a local shell in the displayed directory and review the action again." : "";
      setState((previous) => ({ ...previous, preview: { label: action.label, command, cwd, leafId, target, targetError } }));
    } catch (reason) { setActionError(reason instanceof Error ? reason.message : "Could not prepare this action."); }
  };
  const stage = async () => {
    const preview = current.preview;
    if (!preview || actionsDisabled || staging) return;
    setActionError(""); setActionNotice("");
    if (preview.targetError || preview.leafId == null || !preview.target) { setActionError(preview.targetError || "No verified local terminal is available."); return; }
    if (preview.cwd !== cwd || preview.target.isRemote || preview.target.host !== null || preview.target.cwd !== cwd || getActiveTerminalLeafId() !== preview.leafId) {
      setActionError("The local terminal target changed. Review this action again in the intended terminal."); return;
    }
    setStaging(true);
    try {
      // Shared helper rechecks PTY, connection token and empty/idle prompt.
      await stageScreenCommand(preview.leafId, preview.target, preview.command);
      if (mounted.current && currentScope.current === scope) {
        setState((previous) => previous.preview === preview ? { ...previous, preview: null } : previous);
        setActionNotice("Command staged without Enter. Review it at the local prompt before running.");
      }
    } catch (reason) { if (mounted.current && currentScope.current === scope) setActionError(reason instanceof Error ? reason.message : "Could not stage this command."); }
    finally { if (mounted.current) setStaging(false); }
  };
  const copy = async () => {
    const preview = current.preview; if (!preview) return;
    setActionError("");
    try {
      await writeText(preview.command);
      if (mounted.current && currentScope.current === scope) setActionNotice("Command copied. Review its target before pasting; nothing was executed.");
    } catch { if (mounted.current && currentScope.current === scope) setActionError("Could not copy this command."); }
  };

  return <section className="plugin-panel" aria-label={`${plugin.name} custom tool`}>
    <PanelHeader icon={PuzzleIcon} title={plugin.name} context="Custom tool · Local" actions={<button type="button" onClick={onBack} aria-label="Back to tools" title="Back to tools" className="plugin-panel__back"><HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} /></button>} />
    {plugin.views.length > 1 && <div className="plugin-panel__tabs" role="tablist" aria-label="Custom tool views">
      {plugin.views.map((item, itemIndex) => <button key={`${itemIndex}:${item.title}`} ref={(node) => { tabRefs.current[itemIndex] = node; }} type="button" role="tab" aria-selected={index === itemIndex} aria-controls={panelId} tabIndex={index === itemIndex ? 0 : -1} onClick={() => setViewIndex(itemIndex)} onKeyDown={(event) => {
        const next = event.key === "ArrowRight" ? (itemIndex + 1) % plugin.views.length : event.key === "ArrowLeft" ? (itemIndex - 1 + plugin.views.length) % plugin.views.length : event.key === "Home" ? 0 : event.key === "End" ? plugin.views.length - 1 : null;
        if (next == null) return; event.preventDefault(); setViewIndex(next); tabRefs.current[next]?.focus();
      }}>{item.title}</button>)}
    </div>}
    <div id={panelId} className="plugin-panel__content" aria-busy={busy}>
      <div className="plugin-panel__scope"><span>Local workspace</span><code>{cwd || "No local workspace selected"}</code></div>
      <div className="plugin-panel__source"><span>Exact view command</span><pre>{view?.command || "No view configured"}</pre></div>
      <p className="plugin-panel__notice">Custom commands may change files, services, or data. Review the command and local directory before running. Opening this tool does not execute anything.</p>
      {!cwd && <p className="plugin-panel__warning">Choose a local workspace before running this custom tool.</p>}
      <div className="plugin-panel__controls">
        <button type="button" disabled={!view || !cwd || busy || !active || !visible} onClick={() => { void refresh(!current.authorized); }}>{current.authorized ? "Refresh locally" : "Run view locally"}</button>
        {busy && <button type="button" disabled={stopping} onClick={stop}>{stopping ? "Waiting for command…" : "Stop waiting"}</button>}
        {current.updatedAt != null && <span className="plugin-panel__updated">Updated {new Date(current.updatedAt).toLocaleTimeString()}</span>}
      </div>
      {view?.refresh && <label className="plugin-panel__auto"><input type="checkbox" disabled={!current.authorized || busy || !active || !visible} checked={current.autoRefresh} onChange={(event) => setState((previous) => ({ ...previous, autoRefresh: event.target.checked }))} />Auto-refresh every {view.refresh}s — runs this command repeatedly</label>}
      {current.preview && current.autoRefresh && <p className="plugin-panel__notice">Auto-refresh paused while this action is being reviewed.</p>}
      {current.error && <div className="plugin-panel__error" role="alert"><pre>{current.error}</pre>{current.data && <span>Previously loaded rows are stale. Actions are disabled until a successful refresh.</span>}</div>}
      {current.data?.notice && <p className="plugin-panel__warning">{current.data.notice}</p>}
      {current.stale && !current.error && <p className="plugin-panel__warning">This is partial or stale output. Actions are disabled.</p>}
      {busy && <p role="status" className="plugin-panel__notice">{stopping ? "Discarding results. The command may still be running locally (20-second limit)." : "Running locally…"}</p>}
      {!current.data && !busy && !current.error && <p className="plugin-panel__empty">{current.authorized ? "No output loaded. Refresh when ready." : "Not run. Review the command above to load this view."}</p>}
      {current.data && current.data.rows.length === 0 && <p className="plugin-panel__empty">{view?.empty ?? "Nothing to show."}</p>}
      {current.data?.rows.map((row, rowIndex) => {
        const primary = row[current.data!.columns[0]] || `Row ${rowIndex + 1}`;
        const expanded = current.openRow === rowIndex;
        return <article key={`${rowIndex}:${JSON.stringify(row)}`} className="plugin-panel__row">
          <button type="button" className="plugin-panel__row-toggle" aria-expanded={expanded} onClick={() => setState((previous) => ({ ...previous, openRow: expanded ? null : rowIndex }))}><span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span>{primary}</span></button>
          {expanded && <div className="plugin-panel__row-details"><dl>{Object.entries(row).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>
            {view?.actions?.map((action, actionIndex) => <button key={`${actionIndex}:${action.label}`} type="button" disabled={actionsDisabled} onClick={() => previewAction(action, row)} title="Review the command first; this does not execute it">Review: {action.label}</button>)}
          </div>}
        </article>;
      })}
      {current.preview && <div className="plugin-panel__preview" role="region" aria-label="Custom tool action preview">
        <strong>{current.preview.label}</strong><p className="plugin-panel__notice">Frozen command · Local · {current.preview.cwd}</p>
        <pre>{current.preview.command}</pre>
        <p className="plugin-panel__notice">Stage only places this command into the reviewed, empty local prompt. It never presses Enter. Legacy immediate-run actions are not executed automatically.</p>
        {current.preview.targetError && <p className="plugin-panel__warning" role="alert">{current.preview.targetError}</p>}
        <div className="plugin-panel__controls"><button type="button" onClick={() => { void copy(); }}>Copy command</button><button type="button" disabled={staging || actionsDisabled || Boolean(current.preview.targetError)} onClick={() => { void stage(); }}>{staging ? "Staging…" : "Stage only"}</button><button type="button" disabled={staging} onClick={() => { setState((previous) => ({ ...previous, preview: null })); setActionError(""); setActionNotice(""); }}>Close preview</button></div>
      </div>}
      {actionError && <p role="alert" className="plugin-panel__warning">{actionError}</p>}
      {actionNotice && <p role="status" className="plugin-panel__notice">{actionNotice}</p>}
    </div>
  </section>;
}
