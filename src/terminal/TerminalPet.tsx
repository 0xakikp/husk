import { useEffect, useRef, useState } from "react";
import { useCommandRunning, useActiveTerminalExit } from "../ai/terminalContext";
import { cn } from "../lib/utils";
import "./TerminalPet.css";

const STATE_COLOR: Record<PetState, string> = {
  idle: "bg-foreground",
  typing: "bg-yellow-500",
  success: "bg-emerald-500",
  failure: "bg-red-500",
  running: "bg-amber-500",
  "ci-pass": "bg-emerald-500",
};

const STATE_ANIMATION: Record<PetState, string> = {
  idle: "wf-idle",
  typing: "wf-typing",
  success: "wf-success",
  failure: "wf-failure",
  running: "wf-running",
  "ci-pass": "wf-success",
};

type PetState = "idle" | "typing" | "success" | "failure" | "running" | "ci-pass";

export function TerminalPet({
  className,
  style,
  onClick,
  title = "Open AI chat",
}: {
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  title?: string;
}) {
  const running = useCommandRunning();
  const exitCode = useActiveTerminalExit();
  const [state, setState] = useState<PetState>("idle");
  const lastExitRef = useRef<number | null>(null);
  const [typing, setTyping] = useState(false);
  const typingTimerRef = useRef<number>(0);

  useEffect(() => {
    if (running) {
      setState("running");
      return;
    }

    if (exitCode !== null && exitCode !== lastExitRef.current) {
      lastExitRef.current = exitCode;
      if (exitCode === 0) {
        setState("success");
      } else {
        setState("failure");
      }
      const timer = window.setTimeout(() => setState("idle"), 2500);
      return () => window.clearTimeout(timer);
    }

    if (state === "running" || state === "success" || state === "failure") {
      setState(typing ? "typing" : "idle");
    }
  }, [running, exitCode, state, typing]);

  useEffect(() => {
    const handler = () => {
      setTyping(true);
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => setTyping(false), 400);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleClick = () => {
    if (onClick) onClick();
  };

  return (
    <div
      className={cn("pointer-events-auto z-30 flex flex-col items-end gap-2", className)}
      style={style}
    >
      <button
        type="button"
        onClick={handleClick}
        className="group relative flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-card/90 p-2 shadow-xl backdrop-blur-sm transition hover:scale-105 hover:bg-card"
        title={title}
      >
        <div className="flex h-9 items-end gap-[2px] rounded-md border border-border/50 bg-black/40 px-1.5 py-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={cn(
                "w-1.5 min-h-[15%] rounded-[1px]",
                STATE_COLOR[state],
                STATE_ANIMATION[state]
              )}
              style={{ animationDelay: `${i * 90}ms` }}
            />
          ))}
        </div>
        <span className="text-[8px] font-semibold uppercase tracking-wider text-muted-foreground">AI</span>
      </button>
    </div>
  );
}
