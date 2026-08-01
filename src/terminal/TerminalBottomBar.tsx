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
  Globe02Icon,
  ShieldUserIcon,
  BatteryChargingIcon,
  BatteryFullIcon,
  BatteryLowIcon,
  BatteryMediumIcon,
  CodeIcon,
} from "@hugeicons/core-free-icons";
import { VitalStrip } from "./vitals/VitalStrip";
import { getShellHistory } from "../shellHistory";
import { cachedProjectActions, type ProjectAction } from "./projectActions";
import { useSystemVitals } from "./vitals/useSystemVitals";
import { isRepo, status as gitStatus, currentBranch, branchAheadBehind } from "../git/client";
import { checkDocker } from "../docker/client";
import {
  getActiveTerminalExit,
  getActiveTerminalCwd,
  typeInActiveTerminal,
  getTerminalTyping,
  subscribeTerminalTyping,
  subscribeTerminalState,
} from "../ai/terminalContext";
import { bgList, type BgJob } from "../jobs/client";
import { toast } from "../toast";
import { usePrefs } from "../settings/preferences";
import { getWorkspaceRoot } from "../workspace/store";
import { getActiveSshHost, subscribeSshHost } from "../remote/store";

/* ── Types ─────────────────────────────────────────────── */

type ContextKind = "git-dirty" | "git-clean" | "docker" | "error" | null;

/** Commands whose meaning depends on the directory you are in. */
const PROJECT_RUNNERS = new Set([
  "pnpm", "npm", "yarn", "bun", "npx",
  "cargo", "go", "make", "mvn", "gradle", "./gradlew",
  "poetry", "uv", "rake", "dotnet", "pytest", "tox",
]);

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

function useSshHost() {
  const [host, setHost] = useState(getActiveSshHost);
  useEffect(() => subscribeSshHost(() => setHost(getActiveSshHost())), []);
  return host;
}

function useBattery() {
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean; addEventListener: (e: string, fn: () => void) => void; removeEventListener: (e: string, fn: () => void) => void }> };
    if (!nav.getBattery) return;
    let bat: { level: number; charging: boolean; addEventListener: (e: string, fn: () => void) => void; removeEventListener: (e: string, fn: () => void) => void } | null = null;
    const update = () => {
      if (bat) setBattery({ level: bat.level, charging: bat.charging });
    };
    nav.getBattery().then((b) => {
      bat = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    });
    return () => {
      if (bat) {
        bat.removeEventListener("levelchange", update);
        bat.removeEventListener("chargingchange", update);
      }
    };
  }, []);
  return battery;
}

function useEnvIndicators() {
  const [env, setEnv] = useState<{ python?: string; node?: string }>({});
  useEffect(() => {
    const check = () => {
      const cwd = getActiveTerminalCwd();
      if (!cwd) return;
      // We can't directly read files, but we can check common env vars
      // For now, this is a placeholder — real implementation would need
      // backend command to detect venv/nvm
      setEnv({});
    };
    const unsub = subscribeTerminalState(check);
    check();
    return unsub;
  }, []);
  return env;
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
  const sshHost = useSshHost();
  const battery = useBattery();
  const envIndicators = useEnvIndicators();

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

  /* Destructive or opinionated commands are TYPED at the prompt, not run. Pressing
     Enter is the confirmation, which needs no dialog and lets you edit the command
     first — the point for `git commit -m 'wip'`, where you almost always want a
     real message. `docker system prune -f` would otherwise delete every unused
     image and volume from a single click with no warning. */
  const stage = useCallback((cmd: string) => {
    if (typeInActiveTerminal(cmd)) {
      toast({ title: "Review, then press Enter", message: cmd, variant: "warning" });
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  }, []);

  /* Context actions */
  const contextPills = (() => {
    if (ctx === "git-dirty") {
      return [
        { label: "Commit", icon: GitCommitIcon, action: () => stage("git commit -m 'wip'"), risky: true },
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
        { label: "Prune", icon: CancelCircleIcon, action: () => stage("docker system prune -f"), risky: true },
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
  /* Recent commands, from the shell's own history — the same source Ctrl+R uses.
     This previously scraped xterm's rendered text via
     document.querySelector("[data-terminal]"), an attribute that exists nowhere in
     the codebase, so the element was always null and the list was permanently
     empty. That is why the idle bar only ever showed Clear and ls. It also kept
     just the first word, turning "git status" into "git". */
  const [recentCmds, setRecentCmds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getShellHistory(200)
      .then((rows) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const picked: string[] = [];
        for (const { command } of rows) {
          const cmd = command.trim();
          // Skip noise: bare shells, one-off characters, and anything too long to
          // read in a pill.
          if (cmd.length < 2 || cmd.length > 24) continue;
          if (["bash", "zsh", "sh", "clear", "exit", "ls", "ls -la"].includes(cmd)) continue;
          // Shell history is global — zsh records no cwd — so a project runner from
          // one repo would be offered in every other directory, where it is at best
          // meaningless. Those commands are only valid with project context, which
          // is what projectActions detects; anything needing it is excluded here.
          if (PROJECT_RUNNERS.has(cmd.split(/\s+/)[0]) || cmd.startsWith("./")) continue;
          const key = cmd.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          picked.push(cmd);
          if (picked.length === 2) break;
        }
        setRecentCmds(picked);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [lastExitCode]);

  /* Actions that match the directory the terminal is in, so the idle bar offers
     something specific to this project instead of two universal commands. */
  const [projectActions, setProjectActions] = useState<ProjectAction[]>([]);
  useEffect(() => {
    const dir = getActiveTerminalCwd();
    if (!dir) {
      setProjectActions([]);
      return;
    }
    let cancelled = false;
    void cachedProjectActions(dir)
      .then((a) => {
        if (!cancelled) setProjectActions(a);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [cwd]);

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
              <span className="truncate max-w-[60px]" title={cwd}>{dirName}</span>
            </>
          )}
        </div>
      )}

      {/* SSH connection badge — always visible when connected */}
      {sshHost && (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-600 dark:text-sky-400">
          <HugeiconsIcon icon={Globe02Icon} size={10} strokeWidth={1.5} />
          <span className="truncate max-w-[100px] font-medium">{sshHost}</span>
        </div>
      )}

      {/* Root/sudo indicator */}
      {cwd === "/root" && (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400">
          <HugeiconsIcon icon={ShieldUserIcon} size={10} strokeWidth={1.5} />
          <span className="font-medium">root</span>
        </div>
      )}

      {/* Env indicators (Python venv, Node version) */}
      {envIndicators.python && (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-600 dark:text-blue-400">
          <HugeiconsIcon icon={CodeIcon} size={10} strokeWidth={1.5} />
          <span className="font-medium">{envIndicators.python}</span>
        </div>
      )}
      {envIndicators.node && (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-500/10 px-2 py-0.5 text-[11px] text-green-600 dark:text-green-400">
          <HugeiconsIcon icon={CodeIcon} size={10} strokeWidth={1.5} />
          <span className="font-medium">{envIndicators.node}</span>
        </div>
      )}

      {/* Git branch — always visible, dimmed in idle state */}
      <div className={`transition-opacity duration-150 ${isActive ? "opacity-100" : "opacity-60"}`}>
        {branch && (
          <div className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ${isActive ? "bg-muted/20 text-muted-foreground" : "bg-transparent text-muted-foreground/60"}`}>
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
                title={
                  "risky" in p && p.risky
                    ? "Typed at the prompt for review — press Enter to run"
                    : undefined
                }
                className={
                  "risky" in p && p.risky
                    ? "inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
                    : "inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                }
              >
                <HugeiconsIcon icon={p.icon} size={11} strokeWidth={2.25} />
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
            {/* Project actions — what this directory can actually do */}
            {projectActions.map((a) => (
              <button
                key={a.command}
                type="button"
                onClick={() => send(a.command)}
                className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                title={`Run: ${a.command}`}
              >
                <HugeiconsIcon icon={CodeIcon} size={11} strokeWidth={2.25} />
                {a.label}
              </button>
            ))}
            {/* Recent shell commands, only where a project offered nothing */}
            {projectActions.length === 0 &&
              recentCmds.map((cmd) => (
                <button
                  key={cmd}
                  type="button"
                  onClick={() => send(cmd)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                  title={`Run: ${cmd}`}
                >
                  <HugeiconsIcon icon={CommandIcon} size={11} strokeWidth={2.25} />
                  {cmd}
                </button>
              ))}
            {projectActions.length === 0 && (
              <button
                type="button"
                onClick={() => send("ls -la")}
                className="inline-flex items-center gap-1 rounded-md bg-primary/8 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
                title="List directory"
              >
                <HugeiconsIcon icon={Folder01Icon} size={11} strokeWidth={2.25} />
                ls
              </button>
            )}
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

      {/* Battery indicator */}
      {battery && (
        <div className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground font-mono">
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
            className={
              battery.level < 0.2
                ? "text-red-400"
                : battery.level < 0.4
                  ? "text-amber-400"
                  : "text-emerald-400"
            }
          />
          <span className={battery.level < 0.2 ? "text-red-400" : ""}>
            {Math.round(battery.level * 100)}%
          </span>
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
