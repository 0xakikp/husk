import { useEffect, useState, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Folder01Icon, Globe02Icon, CommandIcon, Copy01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuItem,
} from "../components/ui/dropdown-menu";
import { isRepo, status as gitStatus, currentBranch, branchAheadBehind } from "../git/client";
import { safeTimelineCommand } from "../timeline/commandMetadata";
import { usePrefs } from "../settings/preferences";
import { toast } from "../toast";
import { getSessionStatus, subscribeSessionStatus, openTerminalLogs } from "./registry";
import { getTerminalStatus, subscribeTerminalStatus, type TerminalStatusSnapshot } from "./statusBarState";
import { STATUS_TOOLS, STATUS_TOOL_LABELS, detectStatusToolSignals, detectCommandToolActivities, commandToolLabel, isCommandToolId } from "./statusBarTools";
import { useStatusBarPreferences, updateStatusBarPreferences, type PinnedStatusTool } from "./statusBarPreferences";
import { useSystemVitals } from "./vitals/useSystemVitals";
import { STARTING_TERMINAL, type TerminalSessionStatus } from "./sessionLifecycle";
import "./TerminalBottomBar.css";

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

type GitSummary = { key: string; branch: string; changed: number; ahead: number; behind: number };

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
  const availableMenuTools: PinnedStatusTool[] = [...STATUS_TOOLS, ...new Set([
    ...activities.map((activity) => activity.id), ...display.pinned.filter(isCommandToolId),
  ])];
  const menuTools = [...display.pinned, ...availableMenuTools.filter((tool) => !display.pinned.includes(tool))];
  const toolEvidence = STATUS_TOOLS.map((tool) => {
    const invocations = signals.filter((signal) => signal.tool === tool);
    const candidate = invocations[0]?.override;
    // A compound command does not identify which part is executing. Only show
    // a target when all invocations of this tool name the same literal override.
    const override = candidate && invocations.every((signal) => signal.override?.kind === candidate.kind && signal.override.value === candidate.value)
      ? candidate : null;
    return { tool, override, hasActivity: invocations.length > 0, ambiguous: invocations.length > 1 && !override };
  });
  const visibleTools = running ? toolEvidence.flatMap(({ tool, override }) => override ? [{ tool, override }] : []) : [];
  const vitals = useSystemVitals(detailsOpen || display.machineMetrics);

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
  const toolDetail = (tool: PinnedStatusTool) => {
    if (isCommandToolId(tool)) return `${toolLabel(tool)} · ${activities.some((activity) => activity.id === tool) ? `${running ? "Current" : "Last"} command activity` : "Pinned by you"}. Activity label only; accounts and targets have not been inspected.`;
    const evidence = toolEvidence.find((item) => item.tool === tool)!;
    if (evidence.override) return `${running ? "Current" : "Last"} command ${evidence.override.kind}: ${evidence.override.value}. This override applies to that command, not necessarily the next one. It is not a verified connection target.`;
    if (evidence.ambiguous) return `${STATUS_TOOL_LABELS[tool]} has multiple invocations with different or unknown overrides in this command. No single current target can be inferred.`;
    return `${STATUS_TOOL_LABELS[tool]} target unverified for this terminal. ${evidence.hasActivity ? "Observed in recent command activity." : display.pinned.includes(tool) ? "Pinned in this menu." : "No recent command activity."} Husk has not queried the host or reused local app defaults.`;
  };
  const toolSummary = (tool: PinnedStatusTool) => {
    if (isCommandToolId(tool)) return activities.some((activity) => activity.id === tool)
      ? `${running ? "Current" : "Last"} command · activity only` : "Pinned · activity only";
    const evidence = toolEvidence.find((item) => item.tool === tool)!;
    return evidence.override
      ? `${running ? "Current" : "Last"} ${evidence.override.kind}: ${evidence.override.value}`
      : evidence.ambiguous ? "Mixed / unknown targets" : `Unverified${evidence.hasActivity ? ` · ${running ? "current" : "last"} command` : ""}`;
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
      {visibleTools.length > 0 && <div className="terminal-status__tools">
        {visibleTools.map(({ tool, override }) => <span className="terminal-status__tool" data-tool={tool} key={tool} title={toolDetail(tool)}>
          <span className="terminal-status-menu__tool-dot" data-tool={tool} aria-hidden="true" /><span>{tool === "kubernetes" ? "K8s" : toolLabel(tool)}</span><span aria-hidden="true">·</span><span className="terminal-status__override">{override.kind}: {override.value}</span>
        </span>)}
      </div>}
    </div>
    {display.machineMetrics && <span className="terminal-status__machine" title={`This computer (not the remote host) · ${machineText}`}>
      This computer{vitals ? ` · ${Math.round(vitals.cpu_percent)}% CPU` : " · —"}
    </span>}
    <DropdownMenu open={detailsOpen} onOpenChange={setDetailsOpen}>
      <DropdownMenuTrigger asChild><button type="button" className="terminal-status__more" aria-label="Terminal status details and preferences" title="Terminal status details and preferences">···</button></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" collisionPadding={8} className="husk-context-menu terminal-status-menu">
        <DropdownMenuLabel className="terminal-status-menu__heading"><HugeiconsIcon icon={Globe02Icon} size={12} />Focused terminal<span className="terminal-status-menu__scope" data-scope={scope}>{target}</span></DropdownMenuLabel>
        <p className="terminal-status-menu__detail">{directory || (scope === "remote" ? "Remote folder not reported by this shell." : "Folder not reported by this shell.")}</p>
        <DropdownMenuItem className="husk-context-menu-item" onSelect={openLogs}><HugeiconsIcon icon={CommandIcon} size={12} />View terminal logs</DropdownMenuItem>
        {directory && <DropdownMenuItem className="husk-context-menu-item" onSelect={copyDirectory}><HugeiconsIcon icon={Copy01Icon} size={12} />Copy folder path</DropdownMenuItem>}
        {git?.branch && <DropdownMenuItem className="husk-context-menu-item" onSelect={onOpenSourceControl}><HugeiconsIcon icon={GitBranchIcon} size={12} /><span className="terminal-status-menu__git">{git.branch} · {git.changed} changes · ↑{git.ahead} ↓{git.behind}</span></DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Tools<span className="terminal-status-menu__label-hint">Pin in this menu</span></DropdownMenuLabel>
        {menuTools.map((tool) => <DropdownMenuCheckboxItem key={tool} checked={display.pinned.includes(tool)}
          className="husk-context-menu-item terminal-status-menu__tool" aria-label={`Pin ${toolLabel(tool)}`} title={toolDetail(tool)}
          onCheckedChange={(checked) => updateStatusBarPreferences({ ...display, pinned: checked ? [...display.pinned, tool] : display.pinned.filter((value) => value !== tool) })}
          onSelect={(event) => event.preventDefault()}>
          <span className="terminal-status-menu__tool-row"><span className="terminal-status-menu__tool-name"><span className="terminal-status-menu__tool-dot" data-tool={tool} aria-hidden="true" />{toolLabel(tool)}</span><span className="terminal-status-menu__hint">{toolSummary(tool)}</span></span>
        </DropdownMenuCheckboxItem>)}
        <p className="terminal-status-menu__note">Other CLIs appear here when used. Bar shows current overrides only—no account or host queries.</p>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>This computer<span className="terminal-status-menu__label-hint">Not the remote host</span></DropdownMenuLabel>
        <p className="terminal-status-menu__metrics">{machineText}<time>{new Date(clock).toLocaleTimeString([], { hour12: false })}</time></p>
        <DropdownMenuCheckboxItem className="husk-context-menu-item" checked={display.machineMetrics} onSelect={(event) => event.preventDefault()}
          onCheckedChange={(machineMetrics) => updateStatusBarPreferences({ ...display, machineMetrics: machineMetrics === true })}>Show local machine metrics in bar</DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}
