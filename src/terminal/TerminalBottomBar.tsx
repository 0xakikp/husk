import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GitCommitIcon,
  GitPullRequestIcon,
  RefreshIcon,
  CancelCircleIcon,
  CommandIcon,
  Clock01Icon,
  Folder01Icon,
  HomeIcon,
  ArrowRight01Icon,
  Delete01Icon,
} from "@hugeicons/core-free-icons";
import { VitalStrip } from "./vitals/VitalStrip";
import { useSystemVitals } from "./vitals/useSystemVitals";
import { isRepo, status as gitStatus, currentBranch, branchAheadBehind } from "../git/client";
import { checkDocker } from "../docker/client";
import {
  getActiveTerminalExit,
  getActiveTerminalCwd,
  getTerminalTyping,
  subscribeTerminalTyping,
  subscribeTerminalState,
} from "../ai/terminalContext";
import { bgList, type BgJob } from "../jobs/client";
import { toast } from "../toast";
import { usePrefs } from "../settings/preferences";
import { getWorkspaceRoot } from "../workspace/store";

/* ── Types ─────────────────────────────────────────────── */

type ContextKind = "git-dirty" | "git-clean" | "docker" | "error" | null;

/* ── Small helpers ─────────────────────────────────────── */

function animatedBlockBar(width = 8): string {
  const pos = Math.floor((Date.now() / 400) % width);
  return "░".repeat(pos) + "█" + "░".repeat(width - pos - 1);
}

function timeSince(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function useTyping() {
  const [v, setV] = useState(getTerminalTyping);
  useEffect(() => subscribeTerminalTyping(() => setV(getTerminalTyping())), []);
  return v;
}

function useOnline() {
  const [v, setV] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setV(true);
    const off = () => setV(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return v;
}

/* ── Component ─────────────────────────────────────────── */

export function TerminalBottomBar({ onSendToTerminal }: { onSendToTerminal: (text: string) => void }) {
  const prefs = usePrefs();
  const [ctx, setCtx] = useState<ContextKind>(null);
  const [jobs, setJobs] = useState<BgJob[]>([]);
  const tickRef = useRef(0);

  const [clock, setClock] = useState(new Date());
  const [branch, setBranch] = useState("");
  const [aheadBehind, setAheadBehind] = useState({ ahead: 0, behind: 0 });
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [exitAnim, setExitAnim] = useState(false);

  const typing = useTyping();
  const online = useOnline();
  const vitals = useSystemVitals();

  /* Live clock */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* Detect context + git branch every 3s */
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const cwd = getActiveTerminalCwd() || undefined;
        const [repo, st, docker, br, ab] = await Promise.all([
          isRepo(cwd || null),
          gitStatus(cwd || null).catch(() => [] as never[]),
          checkDocker(),
          currentBranch(cwd || null).catch(() => ""),
          branchAheadBehind(cwd || null).catch(() => ({ ahead: 0, behind: 0 })),
        ]);
        if (cancelled) return;
        const dirty = repo && st.some((f) => !(f.index === "?" && f.work === "?"));
        const exit = getActiveTerminalExit();

        if (dirty) setCtx("git-dirty");
        else if (docker) setCtx("docker");
        else if (exit !== 0 && exit !== null) setCtx("error");
        else setCtx(repo ? "git-clean" : null);

        setBranch(br);
        setAheadBehind(ab);
      } catch {
        // ignore
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  /* Poll jobs */
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await bgList();
        if (cancelled) return;
        setJobs(list.filter((j) => !j.exited));
      } catch {
        // ignore
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  /* Animated tick for job timers */
  useEffect(() => {
    const t = setInterval(() => {
      tickRef.current += 1;
      setJobs((prev) => [...prev]);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* Watch last exit code with animation trigger */
  useEffect(() => {
    const unsub = subscribeTerminalState(() => {
      const code = getActiveTerminalExit();
      if (code !== lastExitCode) {
        setLastExitCode(code);
        setExitAnim(true);
        window.setTimeout(() => setExitAnim(false), 1200);
      }
    });
    return unsub;
  }, [lastExitCode]);

  const send = useCallback(
    (cmd: string) => {
      onSendToTerminal(cmd);
      toast({ title: cmd, variant: "info" });
    },
    [onSendToTerminal],
  );

  /* Context actions */
  const contextPills = (() => {
    if (ctx === "git-dirty") {
      return [
        { label: "Commit", icon: GitCommitIcon, action: () => send("git commit -m 'wip'") },
        { label: "Diff", icon: GitPullRequestIcon, action: () => send("git diff") },
        { label: "Stash", icon: CancelCircleIcon, action: () => send("git stash") },
      ];
    }
    if (ctx === "git-clean") {
      return [
        { label: "Pull", icon: GitPullRequestIcon, action: () => send("git pull") },
        { label: "Status", icon: GitCommitIcon, action: () => send("git status") },
      ];
    }
    if (ctx === "docker") {
      return [
        { label: "PS", icon: CommandIcon, action: () => send("docker ps") },
        { label: "Prune", icon: CancelCircleIcon, action: () => send("docker system prune -f") },
      ];
    }
    if (ctx === "error") {
      const errorActions = [{ label: "Retry", icon: RefreshIcon, action: () => send("!!") }];
      if (prefs.aiEnabled) {
        errorActions.push({ label: "Explain", icon: CommandIcon, action: () => send("/ai explain this error") });
      }
      return errorActions;
    }
    return [];
  })();

  const hasJobs = jobs.length > 0;
  const hasContext = contextPills.length > 0;
  const isActive = hasContext || hasJobs;
  const shimmer = typing || hasJobs;
  const timeStr = clock.toLocaleTimeString("en-US", { hour12: false });

  const workspace = getWorkspaceRoot();
  const cwd = getActiveTerminalCwd();
  const dirName = cwd ? cwd.split("/").pop() || cwd : "";
  const wsName = workspace ? workspace.split("/").pop() || workspace : "";

  /* Recent commands — last 3 unique */
  const [recentCmds, setRecentCmds] = useState<string[]>([]);
  useEffect(() => {
    const unsub = subscribeTerminalState(() => {
      const code = getActiveTerminalExit();
      if (code !== null && code !== lastExitCode) {
        // Try to get last command from terminal history
        const term = document.querySelector("[data-terminal]");
        const lines = term?.textContent?.split("\n") || [];
        const lastLine = lines.slice(-5).find((l) => l.trim() && !l.includes("$") && !l.includes("✓") && !l.includes("✗"));
        if (lastLine) {
          const cmd = lastLine.trim().split(" ")[0];
          if (cmd && cmd.length > 1 && !["bash", "zsh", "sh"].includes(cmd)) {
            setRecentCmds((prev) => {
              const next = [cmd, ...prev.filter((c) => c !== cmd)].slice(0, 3);
              return next;
            });
          }
        }
      }
    });
    return unsub;
  }, [lastExitCode]);

  return (
    <div
      data-command-bar
      data-shimmer={shimmer}
      className="flex h-9 items-center gap-2 border-t border-border/15 bg-background/50 px-2 transition-opacity duration-150"
      onDrop={(e) => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
          const paths = files.map((f) => ((f as unknown as { path?: string }).path) || f.name).join(" ");
          onSendToTerminal(paths);
        }
      }}
      onDragOver={(e) => e.preventDefault()}
    >
      {/* Typing pulse */}
      <div
        className={`size-2 rounded-full transition-all duration-300 ${
          typing
            ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)] animate-pulse"
            : "bg-muted-foreground/20"
        }`}
        title={typing ? "Typing..." : "Idle"}
      />

      {/* Command status */}
      {lastExitCode !== null && (
        <div
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-all ${
            lastExitCode === 0
              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
              : "bg-red-500/15 text-red-600 dark:text-red-400"
          } ${exitAnim ? "scale-125" : "scale-100"}`}
          style={{ transitionDuration: "200ms" }}
        >
          {lastExitCode === 0 ? "✓" : "✗"}
        </div>
      )}

      {/* Workspace name — always visible */}
      {wsName && (
        <div className={`inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground transition-opacity duration-150 ${isActive ? "opacity-70" : ""}`}>
          <HugeiconsIcon icon={HomeIcon} size={10} strokeWidth={1.5} />
          <span className="truncate max-w-[80px] font-medium text-foreground">{wsName}</span>
          {!isActive && dirName && dirName !== wsName && (
            <>
              <HugeiconsIcon icon={ArrowRight01Icon} size={9} strokeWidth={1.5} className="text-muted-foreground/40" />
              <span className="truncate max-w-[60px]">{dirName}</span>
            </>
          )}
        </div>
      )}

      {/* Git branch — active state only */}
      <div className={`transition-opacity duration-150 ${isActive ? "opacity-100" : "opacity-0 w-0 overflow-hidden"}`}>
        {branch && (
          <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/20 px-2 py-0.5 text-[11px] text-muted-foreground">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className="text-muted-foreground/60">
              <path d="M6 1v9.5M6 3.5a2 2 0 1 1-2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <circle cx="6" cy="9.5" r="1" fill="currentColor" />
            </svg>
            <span className="truncate max-w-[80px] font-medium text-foreground">{branch}</span>
            {aheadBehind.ahead > 0 && (
              <span className="inline-flex items-center text-emerald-500">
                <HugeiconsIcon icon={GitPullRequestIcon} size={9} strokeWidth={2} />
                {aheadBehind.ahead}
              </span>
            )}
            {aheadBehind.behind > 0 && (
              <span className="inline-flex items-center text-amber-500">
                <HugeiconsIcon icon={GitPullRequestIcon} size={9} strokeWidth={2} />
                {aheadBehind.behind}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Context pills — active state only */}
      <div className={`transition-opacity duration-150 ${isActive ? "opacity-100" : "opacity-0 w-0 overflow-hidden"}`}>
        {hasContext && (
          <div className="flex shrink-0 items-center gap-1">
            {contextPills.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={p.action}
                className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              >
                <HugeiconsIcon icon={p.icon} size={11} strokeWidth={1.75} />
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Divider — active state only */}
      <div className={`transition-opacity duration-150 ${hasContext && hasJobs ? "opacity-100" : "opacity-0 w-0"}`}>
        <div className="h-4 w-px bg-border/40" />
      </div>

      {/* Job pills — active state only */}
      <div className={`transition-opacity duration-150 flex-1 min-w-0 ${isActive && hasJobs ? "opacity-100" : "opacity-0 w-0 overflow-hidden"}`}>
        {hasJobs && (
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {jobs.map((j) => (
              <div
                key={j.handle}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted/25 px-2 py-0.5 text-[11px] text-foreground"
                title={`${j.command} (${timeSince(j.started_at_ms)})`}
              >
                <span className="font-mono text-muted-foreground">{animatedBlockBar(8)}</span>
                <span className="truncate max-w-[120px]">{j.command.split(" ")[0]}</span>
                <span className="text-muted-foreground">{timeSince(j.started_at_ms)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick actions — idle state only */}
      <div className={`transition-opacity duration-150 ${!isActive ? "opacity-100" : "opacity-0 w-0 overflow-hidden"}`}>
        {!isActive && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => send("clear")}
              className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              title="Clear terminal"
            >
              <HugeiconsIcon icon={Delete01Icon} size={11} strokeWidth={1.75} />
              Clear
            </button>
            {/* Recent commands */}
            {recentCmds.map((cmd) => (
              <button
                key={cmd}
                type="button"
                onClick={() => send(cmd)}
                className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                title={`Run: ${cmd}`}
              >
                <HugeiconsIcon icon={CommandIcon} size={11} strokeWidth={1.75} />
                {cmd}
              </button>
            ))}
            <button
              type="button"
              onClick={() => send("ls -la")}
              className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
              title="List directory"
            >
              <HugeiconsIcon icon={Folder01Icon} size={11} strokeWidth={1.75} />
              ls
            </button>
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="min-w-0 flex-1" />

      {/* System vitals */}
      {vitals && (
        <div className="hidden md:inline-flex shrink-0 items-center gap-2 text-[10.5px] text-muted-foreground font-mono tabular-nums">
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
              <svg width="8" height="8" viewBox="0 0 8 8" className="text-muted-foreground/40">
                <path d="M1 7V4M4 7V2M7 7V5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
              </svg>
              {vitals.load_1.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {/* Live clock */}
      <div className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground font-mono">
        <HugeiconsIcon icon={Clock01Icon} size={10} strokeWidth={1.75} />
        {timeStr}
      </div>

      {/* Terminal vitals (command + duration) */}
      <VitalStrip />

      {/* Online dot */}
      <div
        className={`size-2 rounded-full ${online ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]" : "bg-red-400"}`}
        title={online ? "Online" : "Offline"}
      />
    </div>
  );
}
