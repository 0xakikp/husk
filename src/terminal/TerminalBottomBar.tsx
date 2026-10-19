import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Folder01Icon, Globe02Icon, CommandIcon, Copy01Icon, GitBranchIcon, CloudIcon, ContainerIcon, ComputerTerminal02Icon } from "@hugeicons/core-free-icons";
import { SiKubernetes, SiDocker, SiGooglecloud, SiTerraform, SiPython, SiAnaconda, SiPodman } from "@icons-pack/react-simple-icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuCheckboxItem, DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { isRepo, status as gitStatus, currentBranch, branchAheadBehind } from "../git/client";
import { safeTimelineCommand } from "../timeline/commandMetadata";
import { usePrefs } from "../settings/preferences";
import { toast } from "../toast";
import { getSessionStatus, subscribeSessionStatus, openTerminalLogs } from "./registry";
import { getTerminalStatus, subscribeTerminalStatus, type TerminalStatusSnapshot } from "./statusBarState";
import { STATUS_TOOLS, STATUS_TOOL_LABELS, STATUS_TOOL_CATALOG, canonicalStatusToolId, statusToolOverrides, detectStatusToolSignals, detectCommandToolActivities, commandToolLabel, isCommandToolId } from "./statusBarTools";
import { useStatusBarPreferences, updateStatusBarPreferences, type PinnedStatusTool } from "./statusBarPreferences";
import { useSystemVitals } from "./vitals/useSystemVitals";
import { STARTING_TERMINAL, type TerminalSessionStatus } from "./sessionLifecycle";
import { useTerminalContexts } from "./useTerminalContexts";
import { fitStatusTools } from "./fitStatusTools";
import "./TerminalBottomBar.css";

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

type GitSummary = { key: string; branch: string; changed: number; ahead: number; behind: number };
type BarTool = { tool: PinnedStatusTool; label: string; value: string; detail: string; kind: "current" | "configured" };

function ToolIcon({ tool }: { tool: PinnedStatusTool }) {
  const Brand = ({ kubernetes: SiKubernetes, docker: SiDocker, gcloud: SiGooglecloud, terraform: SiTerraform,
    python: SiPython, conda: SiAnaconda, podman: SiPodman } as Record<string, typeof SiDocker | undefined>)[tool];
  if (Brand) return <Brand size={12} title="" aria-hidden="true" />;
  return <HugeiconsIcon icon={tool === "ssh" ? ComputerTerminal02Icon
    : tool === "orbstack" || tool === "colima" ? ContainerIcon : CloudIcon} size={12} strokeWidth={1.75} aria-hidden="true" />;
}

function ToolInformation({ entries }: { entries: BarTool[] }) {
  const container = useRef<HTMLDivElement>(null);
  const measurer = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(entries.length);
  // A clock tick or menu toggle must not restart the observer. Labels can change
  // with an environment update; font loading and container resizing also refit.
  const signature = JSON.stringify(entries.map(({ tool, value }) => [tool, value]));
  useLayoutEffect(() => {
    const region = container.current, measure = measurer.current;
    if (!region || !measure) return;
    let disposed = false;
    const fit = () => {
      if (disposed) return;
      const available = region.getBoundingClientRect().width;
      const widths = Array.from(measure.querySelectorAll<HTMLElement>("[data-tool-measure]")).map((item) => item.getBoundingClientRect().width);
      // Hidden/unmounted panes have no layout yet. ResizeObserver will refit on
      // reveal; keep all entries available in non-layout test/SSR environments.
      if (!available || widths.some((width) => !width)) return;
      const overflowWidths = Array.from(measure.querySelectorAll<HTMLElement>("[data-overflow-measure]")).map((item) => item.getBoundingClientRect().width);
      const gap = parseFloat(getComputedStyle(region).columnGap) || 0;
      const next = fitStatusTools(widths, available, gap, overflowWidths);
      setCapacity((previous) => previous === next ? previous : next);
    };
    fit();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    observer?.observe(region); observer?.observe(measure);
    document.fonts?.addEventListener("loadingdone", fit);
    void document.fonts?.ready.then(fit);
    return () => { disposed = true; observer?.disconnect(); document.fonts?.removeEventListener("loadingdone", fit); };
  }, [signature]);
  const visible = entries.slice(0, capacity), overflow = entries.slice(capacity);
  const contents = (entry: BarTool) => <><ToolIcon tool={entry.tool} /><span className="terminal-status__override">{entry.value}</span></>;
  return <div ref={container} className="terminal-status__tools" role="group" aria-label="Terminal environments">
    <TooltipProvider delayDuration={350}>
      {visible.map((entry) => <Tooltip key={entry.tool}>
        <TooltipTrigger asChild><span className="terminal-status__tool" data-tool={entry.tool} data-evidence={entry.kind}
          tabIndex={0} aria-label={`${entry.label} · ${entry.detail}`}>
          {contents(entry)}
        </span></TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="terminal-status-tooltip">
          <span className="terminal-status-tooltip__name">{entry.label}</span><span>{entry.detail}</span>
        </TooltipContent>
      </Tooltip>)}
      {overflow.length > 0 && <Tooltip>
        <TooltipTrigger asChild><span className="terminal-status__tool-overflow" tabIndex={0}
          aria-label={`${overflow.length} more environments: ${overflow.map(({ label, value }) => `${label}: ${value}`).join("; ")}. Open terminal status details.`}>
          +{overflow.length}
        </span></TooltipTrigger>
        <TooltipContent side="top" sideOffset={8} className="terminal-status-tooltip">
          {overflow.map(({ tool, label, value }) => <span key={tool}>{label}: {value}</span>)}
          <span className="terminal-status-tooltip__hint">All environments are in terminal status details.</span>
        </TooltipContent>
      </Tooltip>}
    </TooltipProvider>
    <div ref={measurer} className="terminal-status__tool-measurer" aria-hidden="true">
      {entries.map((entry) => <span key={entry.tool} className="terminal-status__tool-measure" data-tool-measure>{contents(entry)}</span>)}
      {entries.map((entry, index) => <span key={entry.tool} className="terminal-status__tool-overflow-measure" data-overflow-measure>+{index + 1}</span>)}
    </div>
  </div>;
}

/** Local reads are bound to the pane, provenance and cwd that requested them. */
function useLocalGit(snapshot: TerminalStatusSnapshot | null, connected: boolean) {
  const [result, setResult] = useState<GitSummary | null>(null);
  const cwd = snapshot?.scope === "local" && connected ? snapshot.cwd : null;
  const key = cwd && snapshot ? `${snapshot.leafId}:${snapshot.scopeKey}:${cwd}` : null;
  const busy = Boolean(snapshot?.command) || snapshot?.startedAt != null;
  const completedAt = snapshot?.lastRun?.at;
  useEffect(() => {
    if (!cwd || !key || busy) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        if (!await isRepo(cwd)) { if (!cancelled) setResult(null); return; }
        if (cancelled) return;
        const [files, branch, counts] = await Promise.all([gitStatus(cwd), currentBranch(cwd), branchAheadBehind(cwd)]);
        if (!cancelled) setResult({ key, branch, changed: files.length, ...counts });
      } catch { if (!cancelled) setResult(null); }
      finally { pending = false; }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 10_000);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [key, cwd, busy, completedAt]);
  return key && result?.key === key ? result : null;
}

export function TerminalBottomBar({ leafId, onSendToTerminal, onOpenSourceControl }: {
  leafId: number | null;
  onSendToTerminal: (text: string) => void;
  onOpenSourceControl: () => void;
}) {
  const snapshot = useSyncExternalStore(
    (listener) => subscribeTerminalStatus(leafId, listener), () => getTerminalStatus(leafId),
  );
  const connection = useSyncExternalStore(
    (listener) => leafId == null ? () => {} : subscribeSessionStatus(leafId, listener),
    () => leafId == null ? STARTING_TERMINAL : getSessionStatus(leafId),
  );
  // A new pane/shell scope cannot inherit another pane's open menu or results.
  return <StatusBarContents key={`${leafId}:${snapshot?.scopeKey ?? "pending"}`} leafId={leafId}
    snapshot={snapshot} connection={connection} onSendToTerminal={onSendToTerminal} onOpenSourceControl={onOpenSourceControl} />;
}

function StatusBarContents({ leafId, snapshot, connection, onSendToTerminal, onOpenSourceControl }: {
  leafId: number | null; snapshot: TerminalStatusSnapshot | null; connection: TerminalSessionStatus;
  onSendToTerminal: (text: string) => void; onOpenSourceControl: () => void;
}) {
  const prefs = usePrefs();
  const display = useStatusBarPreferences();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const catalogInput = useRef<HTMLInputElement>(null);
  const menuContent = useRef<HTMLDivElement>(null);
  const addIntegration = useRef<HTMLDivElement>(null);
  const summaryId = useId();
  const [clock, setClock] = useState(Date.now);
  const connected = connection.state === "ready";
  const running = connected && (Boolean(snapshot?.command) || snapshot?.startedAt != null);
  const lastRun = snapshot?.lastRun;
  const failed = connected && !running && lastRun?.exitCode != null && lastRun.exitCode !== 0;
  const command = running ? snapshot?.command ?? "" : lastRun?.command ?? "";
  const safe = command ? safeTimelineCommand(command) : null;
  const safeCommand = safe?.display ?? "";
  const duration = running && snapshot?.startedAt != null ? clock - snapshot.startedAt : lastRun?.durationMs;
  const scope = snapshot?.scope ?? "unknown";
  const target = scope === "local" ? "Local" : scope === "remote" ? `Remote${snapshot?.host ? `: ${snapshot.host}` : ": target unknown"}` : "Scope unverified";
  const directory = snapshot?.cwd;
  const git = useLocalGit(snapshot, connected);
  // Only derive display metadata from commands covered in full by the existing
  // redaction check. Never expose an override from beyond its 480-char limit.
  const toolCommand = safe?.sensitive || command.length > 480 ? "" : command;
  const signals = detectStatusToolSignals(toolCommand);
  const activities = detectCommandToolActivities(toolCommand);
  const pinned = [...new Set(display.pinned.map(canonicalStatusToolId))];
  const currentTools = [...new Set<PinnedStatusTool>([
    ...signals.map((signal) => signal.tool), ...activities.map((activity) => canonicalStatusToolId(activity.id)),
  ])];
  const observedToolIds = [...new Set<PinnedStatusTool>([
    ...currentTools, ...(snapshot?.recentTools ?? []).map((tool) => canonicalStatusToolId(tool.id)),
  ])];
  const relevantTools = [...pinned, ...observedToolIds];
  const contexts = useTerminalContexts(snapshot, connected, {
    kubernetes: relevantTools.includes("kubernetes"),
    docker: relevantTools.includes("docker") || relevantTools.includes("orbstack"),
  });
  const configured = connected && !running && snapshot?.atPrompt && scope === "local" ? contexts : null;
  const observedTools = [...new Set<PinnedStatusTool>([
    ...observedToolIds, ...(configured?.kubernetes ? ["kubernetes" as const] : []), ...(configured?.docker ? ["docker" as const] : []),
  ])].filter((tool) => !pinned.includes(tool));
  const toolEvidence = STATUS_TOOLS.map((tool) => {
    const invocations = signals.filter((signal) => signal.tool === tool);
    const candidate = invocations[0] ? statusToolOverrides(invocations[0]) : [];
    // A compound command does not identify which part is executing. Only show
    // targets when every invocation names the same complete set of overrides.
    const fingerprint = (values: typeof candidate) => JSON.stringify(values.map(({ kind, value }) => [kind, value]).sort());
    const overrides = candidate.length && invocations.every((signal) => fingerprint(statusToolOverrides(signal)) === fingerprint(candidate))
      ? candidate : [];
    return { tool, overrides, hasActivity: invocations.length > 0, ambiguous: invocations.length > 1 && overrides.length === 0 };
  });
  const vitals = useSystemVitals(detailsOpen || display.machineMetrics);

  useEffect(() => {
    if (detailsOpen && catalogOpen) catalogInput.current?.focus();
  }, [detailsOpen, catalogOpen]);

  useEffect(() => {
    if (!running && !detailsOpen) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running, detailsOpen, snapshot?.startedAt]);

  const stateLabel = leafId == null ? "No terminal" : !connected
    ? ({ starting: "Starting", "slow-start": "Starting", error: "Connection error", disconnected: "Disconnected", unresponsive: "Not responding", exited: "Exited" } as Record<string, string>)[connection.state]
    : running ? "Running" : failed ? `Failed (${lastRun!.exitCode})`
      : lastRun?.exitCode === null ? "Result unavailable" : snapshot?.atPrompt ? "Ready" : "Shell open";
  const stateTitle = !connected ? connection.message || stateLabel
    : safeCommand ? `${running ? "Current" : "Last"} command: ${safeCommand}${lastRun && !running ? ` · ${lastRun.exitCode === null ? "result unavailable" : `exit ${lastRun.exitCode}`}` : ""} · Open terminal logs`
      : `${snapshot?.atPrompt ? "Shell prompt observed" : "Shell prompt has not been verified"} · Open terminal logs`;
  const openLogs = () => {
    if (leafId == null || !openTerminalLogs(leafId)) toast({ title: "No terminal logs available", variant: "info" });
  };
  const copyDirectory = () => {
    if (!directory) return;
    void writeText(directory).then(() => toast({ title: "Folder copied", message: directory, variant: "info" }))
      .catch(() => toast({ title: "Could not copy folder", variant: "error" }));
  };
  const toolLabel = (tool: PinnedStatusTool) => isCommandToolId(tool) ? commandToolLabel(tool) : STATUS_TOOL_LABELS[tool];
  const configuredValue = (tool: PinnedStatusTool) => tool === "kubernetes" && configured?.kubernetes
    ? `${configured.kubernetes.context}${configured.kubernetes.namespace ? ` / ${configured.kubernetes.namespace}` : ""}`
    : tool === "docker" && configured?.docker ? configured.docker.context : null;
  const configuredDetail = (tool: PinnedStatusTool) => tool === "kubernetes" && configured?.kubernetes
    ? `Configured context: ${configured.kubernetes.context}${configured.kubernetes.namespace ? ` · namespace: ${configured.kubernetes.namespace}` : ""}. Read from this terminal's local configuration at the prompt. Configured does not mean connected; command flags can override it.`
    : tool === "docker" && configured?.docker
      ? `Selected context: ${configured.docker.context}. Read from this terminal's ${configured.docker.source === "shell" ? "shell selection" : "local configuration"} at the prompt. Configured does not mean connected; command flags can override it.` : null;
  const unavailableReason = (tool: PinnedStatusTool) => tool === "kubernetes" ? contexts.kubernetesReason : tool === "docker" ? contexts.dockerReason : null;
  const toolDetail = (tool: PinnedStatusTool) => {
    const configuration = configuredDetail(tool);
    if (configuration) return configuration;
    const evidence = toolEvidence.find((item) => item.tool === tool);
    if (evidence?.overrides.length) return `${running ? "Current" : "Last"} command-selected ${evidence.overrides.map(({ kind, value }) => `${kind}: ${value}`).join(" · ")}. These overrides apply to that command, not necessarily the next one. This is not a verified connection target.`;
    if (evidence?.ambiguous) return `${toolLabel(tool)} has multiple invocations with different or unknown overrides in this command. No single current target can be inferred.`;
    return `${toolLabel(tool)} · ${currentTools.includes(tool) ? `${running ? "Current" : "Last"} command activity` : (snapshot?.recentTools ?? []).some((recent) => canonicalStatusToolId(recent.id) === tool) ? "Earlier activity in this terminal scope" : "Not observed here"}. ${unavailableReason(tool) || "No reliable current target; kept in the menu until one is known."} No account, installation or connection checks. Remote terminals never inherit local defaults.`;
  };
  const toolSummary = (tool: PinnedStatusTool) => {
    const value = configuredValue(tool);
    if (value) return `Configured · ${value}`;
    const evidence = toolEvidence.find((item) => item.tool === tool);
    if (evidence?.overrides.length) return `${running ? "Current" : "Last"} ${evidence.overrides.map(({ kind, value }) => `${kind}: ${value}`).join(" · ")}`;
    if (evidence?.ambiguous) return "Mixed / unknown targets";
    if (currentTools.includes(tool)) return `${running ? "Current" : "Last"} command · activity only`;
    return (snapshot?.recentTools ?? []).some((recent) => canonicalStatusToolId(recent.id) === tool) ? "Earlier activity" : unavailableReason(tool) || "Not observed here · no target to show";
  };
  // The bar is an environment summary, not an installed-tool inventory. Only
  // current command selectors or relevant, resolved idle configurations qualify.
  // Last-command values stay in details, even when their tool is pinned.
  const barEntries: BarTool[] = running ? toolEvidence.filter(({ overrides }) => overrides.length > 0).map(({ tool, overrides }) => ({
    tool, label: toolLabel(tool), value: overrides.map(({ value }) => value).join(" / "), detail: toolDetail(tool), kind: "current",
  })) : (["kubernetes", "docker"] as const).flatMap((tool) => {
    const value = configuredValue(tool);
    return value ? [{ tool, label: toolLabel(tool), value, detail: configuredDetail(tool)!, kind: "configured" as const }] : [];
  });
  const isPriority = (tool: PinnedStatusTool) => pinned.includes(tool) || (tool === "docker" && pinned.includes("orbstack"));
  barEntries.sort((left, right) => Number(isPriority(right.tool)) - Number(isPriority(left.tool)));
  const setPinned = (tool: PinnedStatusTool, checked: boolean) => {
    const restoreFocus = document.activeElement?.getAttribute("data-status-tool") === tool;
    updateStatusBarPreferences({ ...display,
      pinned: checked ? [...new Set([...pinned, tool])] : pinned.filter((value) => value !== tool),
    });
    if (restoreFocus) requestAnimationFrame(() => {
      const row = Array.from(menuContent.current?.querySelectorAll<HTMLElement>("[data-status-tool]") ?? [])
        .find((element) => element.getAttribute("data-status-tool") === tool);
      (row ?? addIntegration.current)?.focus();
    });
  };
  const toolRow = (tool: PinnedStatusTool) => <DropdownMenuCheckboxItem key={tool} checked={pinned.includes(tool)}
    className="husk-context-menu-item terminal-status-menu__tool terminal-status-menu__observed-tool" data-status-tool={tool}
    aria-label={`Pin ${toolLabel(tool)}`} aria-describedby={`${summaryId}-${tool}`} title={toolDetail(tool)}
    onCheckedChange={(checked) => setPinned(tool, checked === true)} onSelect={(event) => event.preventDefault()}>
    <span className="terminal-status-menu__tool-row"><span className="terminal-status-menu__tool-name"><span className="terminal-status-menu__tool-dot" data-tool={tool} aria-hidden="true" />{toolLabel(tool)}</span><span id={`${summaryId}-${tool}`} className="terminal-status-menu__hint">{toolSummary(tool)}</span></span>
  </DropdownMenuCheckboxItem>;
  const catalog = [
    ...STATUS_TOOL_CATALOG,
    ...[...new Set([...pinned, ...observedTools])].filter((id) => !STATUS_TOOL_CATALOG.some((entry) => entry.id === id))
      .map((id) => ({ id, label: toolLabel(id), category: "tools", executables: [id.replace(/^cli:/, "")] })),
  ];
  const query = catalogQuery.trim().toLocaleLowerCase();
  const matches = catalog.filter((entry) => [entry.label, entry.category, ...entry.executables].some((value) => value.toLocaleLowerCase().includes(query)));
  const categories: Record<string, string> = { cloud: "Cloud", containers: "Containers & VMs", infrastructure: "Infrastructure", development: "Development", connections: "Connections", databases: "Databases", tools: "Other tools" };
  const backToDetails = () => {
    setCatalogOpen(false);
    setCatalogQuery("");
    requestAnimationFrame(() => addIntegration.current?.focus());
  };
  const machineText = vitals ? `CPU ${Math.round(vitals.cpu_percent)}% · RAM ${(vitals.mem_used_mb / 1024).toFixed(1)} / ${(vitals.mem_total_mb / 1024).toFixed(1)} GiB` : "Metrics unavailable";

  return <div data-command-bar className={`terminal-status${prefs.panelShadows ? " panel-shadow" : ""}`}
    onDrop={(event) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer.files);
      if (files.length) onSendToTerminal(files.map((file) => (file as unknown as { path?: string }).path || file.name).join(" "));
    }} onDragOver={(event) => event.preventDefault()}>
    <div className="terminal-status__main">
      <button type="button" className="terminal-status__state" data-state={failed ? "failed" : running ? "running" : connected ? "idle" : "unavailable"}
        onClick={openLogs} title={stateTitle} aria-label={`${stateLabel} · Open terminal logs`}>
        <span className="terminal-status__dot" aria-hidden="true" />
        <span className="terminal-status__state-label">{stateLabel}</span>
        {(running || failed) && safeCommand && <span className="terminal-status__command">{safeCommand}</span>}
        {connected && duration != null && <span className="terminal-status__duration">· {formatDuration(duration)}</span>}
      </button>
      <span className="terminal-status__target" data-scope={scope} title={scope === "remote"
        ? `${target} · Observed terminal target, not the file browser selection. No remote status probes.`
        : scope === "local" ? "Observed local terminal" : "The terminal has not provided enough metadata to establish its scope."}>
        <HugeiconsIcon icon={Globe02Icon} size={11} strokeWidth={1.75} /><span>{target}</span>
      </span>
      {directory && <button type="button" className="terminal-status__directory" onClick={copyDirectory} title={`${scope === "remote" ? "Observed remote" : "Terminal"} folder: ${directory} · Click to copy`}>
        <HugeiconsIcon icon={Folder01Icon} size={11} strokeWidth={1.75} />
        <span>{directory.split(/[\\/]/).filter(Boolean).pop() || directory}</span>
      </button>}
      {git?.branch && <button type="button" className="terminal-status__git" onClick={onOpenSourceControl}
        title={`${git.branch} · ${git.changed} changed files · ${git.ahead} ahead, ${git.behind} behind · Open Source Control`}>
        <span className="terminal-status__branch">⑂ {git.branch}</span>
        {git.changed > 0 && <span className="terminal-status__warning">{git.changed} changes</span>}
        {git.ahead > 0 && <span>↑{git.ahead}</span>}{git.behind > 0 && <span>↓{git.behind}</span>}
      </button>}
      {barEntries.length > 0 && <ToolInformation entries={barEntries} />}
    </div>
    {display.machineMetrics && <span className="terminal-status__machine" title={`This computer (not the remote host) · ${machineText}`}>
      This computer{vitals ? ` · ${Math.round(vitals.cpu_percent)}% CPU` : " · —"}
    </span>}
    <DropdownMenu open={detailsOpen} onOpenChange={(open) => { setDetailsOpen(open); if (!open) { setCatalogOpen(false); setCatalogQuery(""); } }}>
      <DropdownMenuTrigger asChild><button type="button" className="terminal-status__more" aria-label="Terminal status details and preferences" title="Terminal status details and preferences">···</button></DropdownMenuTrigger>
      <DropdownMenuContent ref={menuContent} side="top" align="end" collisionPadding={8} className="husk-context-menu terminal-status-menu"
        aria-label={catalogOpen ? "Add terminal integration" : "Terminal environment"}
        onPointerMoveCapture={(event) => {
          // Hover must not let menu roving-focus interrupt an in-progress search.
          // Clicking a result and keyboard navigation still move focus normally.
          if (catalogOpen && document.activeElement === catalogInput.current) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => { if (catalogOpen) { event.preventDefault(); backToDetails(); } }}>
        {catalogOpen ? <>
          <DropdownMenuItem className="husk-context-menu-item terminal-status-menu__back" onSelect={(event) => { event.preventDefault(); backToDetails(); }}>← Terminal environment</DropdownMenuItem>
          <DropdownMenuLabel>Add integration<span className="terminal-status-menu__label-hint">Prioritize context</span></DropdownMenuLabel>
          <div className="terminal-status-menu__search-wrap"><input ref={catalogInput} className="terminal-status-menu__search" type="search"
            aria-label="Search integrations" placeholder="Search tools, CLIs, categories…" value={catalogQuery}
            onChange={(event) => setCatalogQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" || event.key === "Tab") return;
              // Radix's menu typeahead must not consume letters/spaces in the search.
              event.stopPropagation();
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const rows = menuContent.current?.querySelectorAll<HTMLElement>("[data-catalog-tool]");
                (event.key === "ArrowDown" ? rows?.[0] : rows?.[rows.length - 1])?.focus();
              }
            }} /></div>
          <div className="terminal-status-menu__catalog" aria-label="Available integrations">
            {matches.length === 0 && <p className="terminal-status-menu__empty" role="status">No matching integrations. Other CLIs appear after they are used here.</p>}
            {Object.entries(categories).map(([category, label]) => {
              const entries = matches.filter((entry) => entry.category === category);
              return entries.length > 0 ? <div key={category}>
                <DropdownMenuLabel>{label}</DropdownMenuLabel>
                {entries.map((entry) => <DropdownMenuCheckboxItem key={entry.id} data-catalog-tool={entry.id} checked={pinned.includes(entry.id)}
                  className="husk-context-menu-item terminal-status-menu__tool" aria-label={`Pin ${entry.label}`}
                  title={`Keep ${entry.label} in this menu and prioritize its known context in the bar. Kubernetes and Docker can read this terminal's local configuration. This does not install, connect to or run the tool.`}
                  onPointerLeave={(event) => { if (document.activeElement === catalogInput.current) event.preventDefault(); }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowUp" && event.currentTarget === menuContent.current?.querySelector("[data-catalog-tool]")) {
                      event.preventDefault(); event.stopPropagation(); catalogInput.current?.focus();
                    }
                  }}
                  onCheckedChange={(checked) => setPinned(entry.id, checked === true)} onSelect={(event) => event.preventDefault()}>
                  <span className="terminal-status-menu__tool-row"><span className="terminal-status-menu__tool-name"><span className="terminal-status-menu__tool-dot" data-tool={entry.id} aria-hidden="true" />{entry.label}</span><span className="terminal-status-menu__hint">{entry.executables.join(" / ")}</span></span>
                </DropdownMenuCheckboxItem>)}
              </div> : null;
            })}
          </div>
          <p className="terminal-status-menu__note">Pins prioritize known contexts. Unknown targets stay in this menu. Local configuration reads only; no commands or account checks.</p>
        </> : <>
        <div className="terminal-status-menu__identity">
          <div className="terminal-status-menu__heading">
            <span className="terminal-status-menu__emblem" aria-hidden="true"><HugeiconsIcon icon={Globe02Icon} size={14} /></span>
            <span className="terminal-status-menu__title">Focused terminal</span>
            <span className="terminal-status-menu__scope" data-scope={scope} title={target}>{scope === "local" ? "Local" : scope === "remote" ? "Remote" : "Unknown"}</span>
          </div>
          {scope === "remote" && snapshot?.host && <p className="terminal-status-menu__host" title={snapshot.host}>{snapshot.host}</p>}
          <p className="terminal-status-menu__detail" title={directory ?? undefined}>{directory || (scope === "remote" ? "Remote folder not reported by this shell." : "Folder not reported by this shell.")}</p>
          <div className="terminal-status-menu__actions">
            <DropdownMenuItem className="husk-context-menu-item terminal-status-menu__quick-action" aria-label="View terminal logs" onSelect={openLogs}><HugeiconsIcon icon={CommandIcon} size={12} />Logs</DropdownMenuItem>
            {directory && <DropdownMenuItem className="husk-context-menu-item terminal-status-menu__quick-action" aria-label="Copy folder path" title={directory} onSelect={copyDirectory}><HugeiconsIcon icon={Copy01Icon} size={12} />Copy path</DropdownMenuItem>}
          </div>
          {git?.branch && <DropdownMenuItem className="husk-context-menu-item terminal-status-menu__git" aria-label="Open Source Control"
            title={`${git.branch} · ${git.changed} changes · ↑${git.ahead} ↓${git.behind}`} onSelect={onOpenSourceControl}>
            <HugeiconsIcon icon={GitBranchIcon} size={12} /><span className="terminal-status-menu__git-branch">{git.branch}</span>
            <span className="terminal-status-menu__git-changes" data-changed={git.changed > 0}>{git.changed} changes</span><span className="terminal-status-menu__git-sync">↑{git.ahead} ↓{git.behind}</span>
          </DropdownMenuItem>}
        </div>
        <div className="terminal-status-menu__integrations">
          <div className="terminal-status-menu__tool-list" role="group" aria-label="Terminal tools">
            {pinned.length > 0 && <><DropdownMenuLabel>Pinned<span className="terminal-status-menu__label-hint">Context priority · {pinned.length}</span></DropdownMenuLabel>{pinned.map(toolRow)}</>}
            {(observedTools.length > 0 || pinned.length === 0) && <>
              <DropdownMenuLabel>Observed here<span className="terminal-status-menu__label-hint">Not pinned</span></DropdownMenuLabel>
              {observedTools.length > 0 ? observedTools.map(toolRow) : <p className="terminal-status-menu__empty">Tools appear as you use them here.</p>}
            </>}
          </div>
          <DropdownMenuItem ref={addIntegration} className="husk-context-menu-item terminal-status-menu__add" onSelect={(event) => { event.preventDefault(); setCatalogOpen(true); }}><span aria-hidden="true">＋</span>Add integration<span className="terminal-status-menu__add-arrow" aria-hidden="true">›</span></DropdownMenuItem>
        </div>
        <p className="terminal-status-menu__note" title="Local configuration and command selections—not installed or connected status. Last-command values stay in this menu; remote terminals never inherit local configuration.">Known contexts in the bar. No account or host queries.</p>
        <div className="terminal-status-menu__machine">
          <DropdownMenuLabel>This computer<time className="terminal-status-menu__label-hint">{new Date(clock).toLocaleTimeString([], { hour12: false })}</time></DropdownMenuLabel>
          <p className="terminal-status-menu__machine-note">Local metrics · not the remote host</p>
          {vitals ? <dl className="terminal-status-menu__metrics" aria-label={machineText}>
            <div><dt>CPU</dt><dd>{Math.round(vitals.cpu_percent)}<span>%</span></dd></div>
            <div><dt>Memory</dt><dd>{(vitals.mem_used_mb / 1024).toFixed(1)}<span> / {(vitals.mem_total_mb / 1024).toFixed(1)} GiB</span></dd></div>
          </dl> : <p className="terminal-status-menu__empty">Metrics unavailable</p>}
          <DropdownMenuCheckboxItem className="husk-context-menu-item terminal-status-menu__metrics-toggle" aria-label="Show local machine metrics in bar" checked={display.machineMetrics} onSelect={(event) => event.preventDefault()}
            onCheckedChange={(machineMetrics) => updateStatusBarPreferences({ ...display, machineMetrics: machineMetrics === true })}>Show in status bar</DropdownMenuCheckboxItem>
        </div>
        </>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
