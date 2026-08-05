import { useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";
import {
  Clock01Icon,
  Folder01Icon,
  Globe02Icon,
  ShieldUserIcon,
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
} from "@hugeicons/core-free-icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useSystemVitals } from "./vitals/useSystemVitals";
import { isRepo, status as gitStatus, currentBranch, branchAheadBehind } from "../git/client";
import {
  getActiveTerminalExit,
  getActiveTerminalCwd,
  getCommandStartTime,
  getCurrentCommand,
  getTerminalTyping,
  isCommandRunning,
  subscribeCommandState,
  subscribeTerminalState,
} from "../ai/terminalContext";
import { openActiveTerminalLogs } from "./registry";
import { isProtectedTarget, refreshEnvSignals, useEnvSignals } from "./envSignals";
import { toast } from "../toast";
import { usePrefs } from "../settings/preferences";
import { getActiveSshHost, subscribeSshHost } from "../remote/store";

/* ── Small helpers ─────────────────────────────────────── */

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function commandLabel(command: string): string {
  const compact = command.trim().replace(/\s+/g, " ");
  if (!compact) return "terminal";
  return compact.length > 38 ? `${compact.slice(0, 37)}…` : compact;
}

function useSshHost() {
  const [host, setHost] = useState(getActiveSshHost);
  useEffect(() => subscribeSshHost(() => setHost(getActiveSshHost())), []);
  return host;
}

function useBattery() {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);

  useEffect(() => {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{
        level: number;
        charging: boolean;
        addEventListener: (event: string, callback: () => void) => void;
        removeEventListener: (event: string, callback: () => void) => void;
      }>;
    };
    if (!nav.getBattery) return;

    let source: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    const update = () => {
      if (source) setBattery({ level: source.level, charging: source.charging });
    };

    void nav.getBattery().then((next) => {
      source = next;
      update();
      next.addEventListener("levelchange", update);
      next.addEventListener("chargingchange", update);
    });

    return () => {
      source?.removeEventListener("levelchange", update);
      source?.removeEventListener("chargingchange", update);
    };
  }, []);

  return battery;
}

type CommandState = {
  command: string;
  running: boolean;
  startedAt: number;
};

function currentCommandState(): CommandState {
  return {
    command: getCurrentCommand(),
    running: isCommandRunning(),
    startedAt: getCommandStartTime(),
  };
}

/* ── Component ─────────────────────────────────────────── */

/**
 * A stable terminal context strip. It deliberately answers only three things:
 * what the terminal is doing (or last did), where it is, and what Git sees.
 * Commands such as Docker cleanup and shell history no longer compete for this
 * compact space, which keeps its shape stable from moment to moment.
 */
export function TerminalBottomBar({
  onSendToTerminal,
  onOpenSourceControl,
}: {
  onSendToTerminal: (text: string) => void;
  onOpenSourceControl: () => void;
}) {
  const prefs = usePrefs();
  const [clock, setClock] = useState(new Date());
  const [branch, setBranch] = useState("");
  const [changedFiles, setChangedFiles] = useState(0);
  const [aheadBehind, setAheadBehind] = useState({ ahead: 0, behind: 0 });
  const [cwd, setCwd] = useState(getActiveTerminalCwd);
  const [lastExitCode, setLastExitCode] = useState<number | null>(getActiveTerminalExit);
  const [commandState, setCommandState] = useState<CommandState>(currentCommandState);
  const [lastCommand, setLastCommand] = useState(getCurrentCommand);
  const [lastDuration, setLastDuration] = useState(0);
  const commandRef = useRef(currentCommandState());

  const vitals = useSystemVitals();
  const sshHost = useSshHost();
  const battery = useBattery();
  const env = useEnvSignals();

  /* Environment signals (k8s / AWS / Docker) refresh on cwd changes and a
     relaxed interval — each probe is a subprocess, so unlike the 5s git poll
     this one stays deliberately slow. The store additionally throttles. */
  useEffect(() => {
    refreshEnvSignals();
    const interval = window.setInterval(() => refreshEnvSignals(), 60_000);
    return () => window.clearInterval(interval);
  }, [cwd]);

  /* A single timer drives both the clock and the elapsed-time display. */
  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /* Keep the command chip useful after a command has completed. The terminal
     context intentionally clears its foreground command at completion, so this
     small local cache preserves the last meaningful command and its duration. */
  useEffect(() => {
    const sync = () => {
      const next = currentCommandState();
      const previous = commandRef.current;

      if (next.command) setLastCommand(next.command);
      if (previous.running && !next.running && previous.startedAt > 0) {
        setLastDuration(Date.now() - previous.startedAt);
      }

      commandRef.current = next;
      setCommandState(next);
    };

    sync();
    return subscribeCommandState(sync);
  }, []);

  useEffect(() => {
    const sync = () => {
      setLastExitCode(getActiveTerminalExit());
      setCwd(getActiveTerminalCwd());
    };
    sync();
    return subscribeTerminalState(sync);
  }, []);

  /* Git state is metadata, not a control surface. Refresh when terminal state
     changes and on a relaxed interval, so switching directories updates the
     chip promptly without polling the terminal every render. */
  useEffect(() => {
    let cancelled = false;
    let request = 0;

    const refresh = async () => {
      const requestId = ++request;
      if (!cwd) {
        if (!cancelled && requestId === request) {
          setBranch("");
          setChangedFiles(0);
          setAheadBehind({ ahead: 0, behind: 0 });
        }
        return;
      }

      try {
        const [repo, files, nextBranch, nextAheadBehind] = await Promise.all([
          isRepo(cwd),
          gitStatus(cwd),
          currentBranch(cwd),
          branchAheadBehind(cwd),
        ]);
        if (cancelled || requestId !== request) return;

        setBranch(repo ? nextBranch : "");
        setChangedFiles(repo ? files.length : 0);
        setAheadBehind(repo ? nextAheadBehind : { ahead: 0, behind: 0 });
      } catch {
        if (cancelled || requestId !== request) return;
        setBranch("");
        setChangedFiles(0);
        setAheadBehind({ ahead: 0, behind: 0 });
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [cwd]);

  const directory = cwd ? cwd.split("/").pop() || cwd : "";
  const activeCommand = commandState.command || lastCommand;
  const elapsed = commandState.running
    ? formatDuration(Date.now() - commandState.startedAt)
    : lastDuration > 0
      ? formatDuration(lastDuration)
      : null;
  const hasFailed = !commandState.running && lastExitCode !== null && lastExitCode !== 0;
  const isTyping = getTerminalTyping();

  const openLogs = () => {
    if (!openActiveTerminalLogs()) {
      toast({ title: "No active terminal logs", variant: "error" });
    }
  };

  const copyDirectory = () => {
    if (!cwd) return;
    void writeText(cwd)
      .then(() => toast({ title: "Folder copied", message: cwd, variant: "info" }))
      .catch(() => toast({ title: "Could not copy folder", variant: "error" }));
  };

  return (
    <div
      data-command-bar
      /* Translucent on purpose: this strip sits inside the terminal panel, so
         the wallpaper may show through without turning window chrome transparent. */
      className={cn(
        "flex h-7 shrink-0 items-center gap-2 overflow-hidden rounded-lg border border-border/15 bg-background/50 px-3",
        prefs.panelShadows && "panel-shadow",
      )}
      onDrop={(event) => {
        event.preventDefault();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
          const paths = files.map((file) => ((file as unknown as { path?: string }).path) || file.name).join(" ");
          onSendToTerminal(paths);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
    >
      {/* Command state: a click always opens the focused terminal's Logs view. */}
      <button
        type="button"
        onClick={openLogs}
        title={activeCommand ? `${activeCommand} — open Logs` : "Open Logs"}
        className={cn(
          "inline-flex min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors hover:bg-muted/45",
          hasFailed ? "text-red-400" : commandState.running ? "text-emerald-400" : "text-muted-foreground",
        )}
      >
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            hasFailed
              ? "bg-red-400 shadow-[0_0_5px_rgba(248,113,113,0.55)]"
              : commandState.running
                ? "animate-pulse bg-emerald-400 shadow-[0_0_5px_rgba(52,211,153,0.55)]"
                : isTyping
                  ? "animate-pulse bg-amber-400"
                  : "bg-muted-foreground/35",
          )}
        />
        <span className="shrink-0 text-muted-foreground/75">
          {hasFailed ? "failed:" : commandState.running ? "running:" : activeCommand ? "last:" : "ready"}
        </span>
        {activeCommand && <span className="truncate text-foreground/90">{commandLabel(activeCommand)}</span>}
        {elapsed && <span className="shrink-0 text-muted-foreground/65">· {elapsed}</span>}
      </button>

      {/* Current terminal directory. Clicking copies the absolute path without
          changing focus or unexpectedly opening another app surface. */}
      {cwd && (
        <button
          type="button"
          onClick={copyDirectory}
          title={`Copy folder path: ${cwd}`}
          className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        >
          <HugeiconsIcon icon={Folder01Icon} size={11} strokeWidth={1.75} />
          <span className="max-w-[130px] truncate">{directory}</span>
        </button>
      )}

      {/* Git is intentionally one quiet chip. It opens the existing Source
          Control rail rather than exposing a shifting row of Git actions here. */}
      {branch && (
        <button
          type="button"
          onClick={onOpenSourceControl}
          title="Open Source Control"
          className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M6 1v9.5M6 3.5a2 2 0 1 1-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="6" cy="9.5" r="1" fill="currentColor" />
          </svg>
          <span className="max-w-[90px] truncate text-foreground/85">{branch}</span>
          {changedFiles > 0 && <span className="text-amber-400">~{changedFiles}</span>}
          {aheadBehind.ahead > 0 && <span className="text-emerald-400">↑{aheadBehind.ahead}</span>}
          {aheadBehind.behind > 0 && <span className="text-amber-400">↓{aheadBehind.behind}</span>}
        </button>
      )}

      {/* Remote context appears only when it changes the meaning of the shell. */}
      {sshHost && (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] text-sky-400" title={`Connected to ${sshHost}`}>
          <HugeiconsIcon icon={Globe02Icon} size={10} strokeWidth={1.5} />
          <span className="max-w-[100px] truncate">{sshHost}</span>
        </div>
      )}

      {/* Operational context: what kubectl / aws / docker commands would hit.
          Production-looking targets get a deliberate accent — impossible to
          miss, but not blocking (Release 3 adds confirmations). */}
      {env.kubeContext && (
        <button
          type="button"
          onClick={() => refreshEnvSignals(true)}
          title={`Kubernetes context: ${env.kubeContext}${isProtectedTarget(env.kubeContext) ? " — protected target" : ""} · click to refresh`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors",
            isProtectedTarget(env.kubeContext)
              ? "border border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
              : "text-violet-400 hover:bg-muted/45",
          )}
        >
          {isProtectedTarget(env.kubeContext) && <span className="text-[9px] font-semibold">⚠ PROD</span>}
          <span>☸</span>
          <span className="max-w-[110px] truncate">{env.kubeContext}</span>
        </button>
      )}
      {env.awsProfile && (
        <button
          type="button"
          onClick={() => refreshEnvSignals(true)}
          title={`AWS profile: ${env.awsProfile}${isProtectedTarget(env.awsProfile) ? " — protected target" : ""} · click to refresh`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors",
            isProtectedTarget(env.awsProfile)
              ? "border border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
              : "text-orange-400/90 hover:bg-muted/45",
          )}
        >
          {isProtectedTarget(env.awsProfile) && <span className="text-[9px] font-semibold">⚠ PROD</span>}
          <span>☁</span>
          <span className="max-w-[100px] truncate">{env.awsProfile}</span>
        </button>
      )}
      {env.dockerContext && (
        <button
          type="button"
          onClick={() => refreshEnvSignals(true)}
          title={`Docker context: ${env.dockerContext}${isProtectedTarget(env.dockerContext) ? " — protected target" : ""} · click to refresh`}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition-colors",
            isProtectedTarget(env.dockerContext)
              ? "border border-amber-400/40 text-amber-400 hover:bg-amber-400/10"
              : "text-sky-400/90 hover:bg-muted/45",
          )}
        >
          {isProtectedTarget(env.dockerContext) && <span className="text-[9px] font-semibold">⚠ PROD</span>}
          <span>🐳</span>
          <span className="max-w-[90px] truncate">{env.dockerContext}</span>
        </button>
      )}
      {cwd === "/root" && (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] text-amber-400">
          <HugeiconsIcon icon={ShieldUserIcon} size={10} strokeWidth={1.5} />
          root
        </div>
      )}

      <div className="min-w-0 flex-1" />

      {/* Host metrics stay on the right: CPU, memory, load, battery and clock
          retain a fixed home regardless of terminal context. */}
      {vitals && (
        <div className="hidden shrink-0 items-center gap-2 font-mono text-[10.5px] tabular-nums text-muted-foreground md:inline-flex">
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-amber-500/60" />
            {Math.round(vitals.cpu_percent)}%
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-sky-500/60" />
            {Math.round(vitals.mem_used_mb / 1024)}G
            <span className="text-muted-foreground/40">/</span>
            {Math.round(vitals.mem_total_mb / 1024)}G
          </span>
          {vitals.load_1 > 0 && (
            <span className="inline-flex items-center gap-1">
              <svg width="8" height="8" viewBox="0 0 8 8" className="text-muted-foreground/40" aria-hidden="true">
                <path d="M1 7V4M4 7V2M7 7V5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
              {vitals.load_1.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {battery && (
        <div className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground sm:inline-flex">
          <HugeiconsIcon
            icon={
              battery.charging
                ? BatteryChargingIcon
                : battery.level > 0.75
                  ? BatteryFullIcon
                  : battery.level > 0.3
                    ? BatteryMediumIcon
                    : BatteryLowIcon
            }
            size={10}
            strokeWidth={1.75}
            className={battery.level < 0.2 ? "text-red-400" : battery.level < 0.4 ? "text-amber-400" : "text-emerald-400"}
          />
          <span className={battery.level < 0.2 ? "text-red-400" : ""}>{Math.round(battery.level * 100)}%</span>
        </div>
      )}

      <div className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground sm:inline-flex">
        <HugeiconsIcon icon={Clock01Icon} size={10} strokeWidth={1.75} />
        {clock.toLocaleTimeString("en-US", { hour12: false })}
      </div>

    </div>
  );
}
