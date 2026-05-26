# Plan: Make Terminal Bottom Bar Feel Alive

## Overview
Add real-time visual life to the TerminalBottomBar: typing pulse, live clock, command status dot, git branch with ahead/behind, ambient shimmer background, and online/offline indicator.

## Step 1: Add `branchAheadBehind` to `src/git/client.ts`

After `currentBranch()` add:

```ts
export async function branchAheadBehind(): Promise<{ ahead: number; behind: number }> {
  const out = await git("rev-list --left-right --count HEAD...@{u}").catch(() => "");
  const [ahead = 0, behind = 0] = out.trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
  return { ahead, behind };
}
```

## Step 2: Add typing tracking to `src/ai/terminalContext.ts`

After the last export (`useActiveTerminalCwd`) add:

```ts
let typing = false;
const typingSubscribers = new Set<() => void>();

function emitTyping(): void {
  for (const fn of typingSubscribers) fn();
}

export function setTerminalTyping(active: boolean): void {
  if (typing === active) return;
  typing = active;
  emitTyping();
}

export function getTerminalTyping(): boolean {
  return typing;
}

export function subscribeTerminalTyping(fn: () => void): () => void {
  typingSubscribers.add(fn);
  return () => typingSubscribers.delete(fn);
}
```

## Step 3: Wire typing in `src/Terminal.tsx`

In the `term.onData()` handler (around line 188), add after interceptTerminalInput check:

```ts
import { setTerminalTyping } from "./ai/terminalContext";

// In the onData handler:
setTerminalTyping(true);
window.clearTimeout(typingTimer);
typingTimer = window.setTimeout(() => setTerminalTyping(false), 400);
```

Also declare `let typingTimer = 0;` near the start of the active terminal effect.

## Step 4: Add shimmer keyframe to `src/styles/tailwind.css`

Add anywhere in the CSS file:

```css
@keyframes bar-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

[data-command-bar] {
  --shimmer-base: transparent;
}

[data-command-bar][data-shimmer="true"] {
  background-image: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--accent, hsl(142 76% 36%)) 6%, transparent) 50%,
    transparent 100%
  );
  background-size: 200% 100%;
  animation: bar-shimmer 3s linear infinite;
}
```

## Step 5: Rewrite `src/terminal/TerminalBottomBar.tsx`

Full rewrite. Key changes:

1. **New imports**: add `branchAheadBehind` from git/client, add `getTerminalTyping`, `subscribeTerminalTyping`, `subscribeTerminalState`, `getActiveTerminalCwd` from ai/terminalContext, add online/offline icons, clock icon

2. **New state**: `typing`, `clock`, `branch`, `online`, `lastExitCode`, `commandCount`

3. **Online check**: `navigator.onLine` + `online`/`offline` event listeners

4. **Clock tick**: `setInterval` every 1s

5. **Typing subscribe**: use `useSyncExternalStore` pattern or `useEffect` + `subscribeTerminalTyping`

6. **Git branch polling**: fetch branch + ahead/behind every 3s alongside context

7. **Command status**: use `lastExit` from terminalContext — animate a dot: green ✓ for 0, red ✗ for non-0/null

8. **Ambient shimmer**: set `data-shimmer="true"` when typing or jobs running

9. **Layout (left-to-right)**:
   - Typing pulse dot (pulsing when typing)
   - Command status dot (green check / red X, animated on change)
   - Git branch pill with ahead/behind arrows
   - Context pills (existing)
   - Divider
   - Job pills (existing)
   - Spacer
   - Live clock HH:MM:SS (monospace)
   - Online/offline dot
   - Mini input / Cmd button

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  GitCommitIcon,
  GitPullRequestIcon,
  RefreshIcon,
  CancelCircleIcon,
  Chatting01Icon,
  CommandIcon,
  Wifi01Icon,
  WifiOff01Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { isRepo, status as gitStatus, currentBranch, branchAheadBehind } from "../git/client";
import { checkDocker } from "../docker/client";
import {
  getActiveTerminalExit,
  getTerminalTyping,
  subscribeTerminalTyping,
  subscribeTerminalState,
} from "../ai/terminalContext";
import { bgList, type BgJob } from "../jobs/client";
import { toast } from "../toast";

type ContextKind = "git-dirty" | "git-clean" | "docker" | "error" | null;

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

export function TerminalBottomBar({ onSendToTerminal }: { onSendToTerminal: (text: string) => void }) {
  const [ctx, setCtx] = useState<ContextKind>(null);
  const [jobs, setJobs] = useState<BgJob[]>([]);
  const [inputOpen, setInputOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const tickRef = useRef(0);
  const [clock, setClock] = useState(new Date());
  const [branch, setBranch] = useState("");
  const [aheadBehind, setAheadBehind] = useState({ ahead: 0, behind: 0 });
  const [lastExitCode, setLastExitCode] = useState<number | null>(null);
  const [exitAnim, setExitAnim] = useState(false);
  const [commandCount, setCommandCount] = useState(0);
  const typing = useTyping();
  const online = useOnline();

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
        const [repo, st, docker, br, ab] = await Promise.all([
          isRepo(),
          gitStatus().catch(() => [] as never[]),
          checkDocker(),
          currentBranch().catch(() => ""),
          branchAheadBehind().catch(() => ({ ahead: 0, behind: 0 })),
        ]);
        if (cancelled) return;
        const dirty = repo && st.length > 0;
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

  /* Count commands via exit code changes (simple heuristic) */
  useEffect(() => {
    const unsub = subscribeTerminalState(() => {
      const code = getActiveTerminalExit();
      if (code !== null) setCommandCount((c) => c + 1);
    });
    return unsub;
  }, []);

  const send = useCallback(
    (cmd: string) => {
      onSendToTerminal(cmd);
      toast({ title: cmd, variant: "info" });
    },
    [onSendToTerminal],
  );

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
      return [
        { label: "Retry", icon: RefreshIcon, action: () => send("!!") },
        { label: "Explain", icon: CommandIcon, action: () => send("/ai explain this error") },
      ];
    }
    return [];
  })();

  const hasJobs = jobs.length > 0;
  const hasContext = contextPills.length > 0;
  const shimmer = typing || hasJobs;
  const timeStr = clock.toLocaleTimeString("en-US", { hour12: false });

  if (!hasContext && !hasJobs && !inputOpen) {
    return (
      <button
        type="button"
        onClick={() => {
          setInputOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className="flex h-11 w-full items-center gap-2 border-t border-border/25 bg-muted/10 px-3 text-[13px] text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
      >
        <HugeiconsIcon icon={Chatting01Icon} size={15} strokeWidth={1.5} />
        <span className="opacity-50">Husk anything… Drop files, # / @ to reference</span>
      </button>
    );
  }

  return (
    <div
      data-command-bar
      data-shimmer={shimmer}
      className="flex h-11 items-center gap-2 border-t border-border/25 bg-muted/10 px-2"
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
          typing ? "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)] animate-pulse" : "bg-muted-foreground/20"
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

      {/* Git branch */}
      {branch && (
        <div className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
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

      {/* Context pills */}
      {hasContext && (
        <div className="flex shrink-0 items-center gap-1">
          {contextPills.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={p.action}
              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-[12px] font-medium text-primary transition-colors hover:bg-primary/20"
            >
              <HugeiconsIcon icon={p.icon} size={11} strokeWidth={1.75} />
              {p.label}
            </button>
          ))}
        </div>
      )}

      {/* Divider */}
      {hasContext && hasJobs && <div className="h-4 w-px bg-border/40" />}

      {/* Job pills */}
      {hasJobs && (
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {jobs.map((j) => (
            <div
              key={j.handle}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1 text-[12px] text-foreground"
              title={`${j.command} (${timeSince(j.started_at_ms)})`}
            >
              <span className="font-mono text-muted-foreground">{animatedBlockBar(8)}</span>
              <span className="truncate max-w-[120px]">{j.command.split(" ")[0]}</span>
              <span className="text-muted-foreground">{timeSince(j.started_at_ms)}</span>
            </div>
          ))}
        </div>
      )}

      {!hasJobs && <div className="min-w-0 flex-1" />}

      {/* Live clock */}
      <div className="hidden sm:inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground font-mono">
        <HugeiconsIcon icon={Clock01Icon} size={10} strokeWidth={1.75} />
        {timeStr}
      </div>

      {/* Online dot */}
      <div
        className={`size-2 rounded-full ${online ? "bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.5)]" : "bg-red-400"}`}
        title={online ? "Online" : "Offline"}
      />

      {/* Mini input */}
      {inputOpen ? (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-muted-foreground text-[11px]">→</span>
          <input
            ref={inputRef}
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = inputVal.trim();
                if (v) onSendToTerminal(v);
                setInputVal("");
                setInputOpen(false);
              } else if (e.key === "Escape") {
                setInputOpen(false);
                setInputVal("");
              }
            }}
            onBlur={() => {
              if (!inputVal.trim()) setInputOpen(false);
            }}
            placeholder="Command…"
            className="w-40 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/40 outline-none"
            style={{ outline: "none", boxShadow: "none", border: "none" }}
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              setInputOpen(false);
              setInputVal("");
            }}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setInputOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
          title="Quick command"
        >
          <HugeiconsIcon icon={Chatting01Icon} size={12} strokeWidth={1.75} />
          <span className="hidden sm:inline">Cmd</span>
        </button>
      )}
    </div>
  );
}
```

## Step 6: Verify build passes

Run `npx tsc --noEmit` and fix any errors.
