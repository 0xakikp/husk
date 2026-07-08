import { useEffect, useRef, useState } from "react";
import { useCommandRunning, useActiveTerminalExit } from "../ai/terminalContext";
import { cn } from "../lib/utils";
import "./TerminalPet.css";

const STATE_RING: Record<PetState, string> = {
  idle: "border-primary/60",
  typing: "border-yellow-400",
  success: "border-emerald-400",
  failure: "border-red-400",
  running: "border-amber-400",
  "ci-pass": "border-emerald-400",
};

const STATE_DOT: Record<PetState, string> = {
  idle: "bg-blue-400",
  typing: "bg-yellow-400",
  success: "bg-emerald-400",
  failure: "bg-red-400",
  running: "bg-amber-400",
  "ci-pass": "bg-emerald-400",
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

  const busy = state === "running" || state === "typing";

  return (
    <div
      className={cn("pointer-events-auto z-30 flex flex-col items-end gap-2", className)}
      style={style}
    >
      <button
        type="button"
        onClick={handleClick}
        className="group relative flex items-center justify-center rounded-2xl border border-border/60 bg-card/90 p-2 shadow-xl backdrop-blur-sm transition hover:scale-105 hover:bg-card"
        title={title}
      >
        <div className="relative inline-flex size-8 items-center justify-center">
          <div
            className={cn(
              "absolute inset-0 rounded-full border-2 border-b-transparent transition-colors",
              STATE_RING[state],
              busy && "pet-spin"
            )}
          />
          <span className={cn("size-1.5 rounded-full", STATE_DOT[state])} />
        </div>
      </button>
    </div>
  );
}
