import { useEffect, useRef, useState } from "react";
import { useCommandRunning, useActiveTerminalExit } from "../ai/terminalContext";
import { cn } from "../lib/utils";

const PET_DOT: Record<PetState, string> = {
  idle: "bg-blue-400",
  typing: "bg-yellow-400",
  success: "bg-emerald-400",
  failure: "bg-red-400",
  running: "bg-amber-400",
  "ci-pass": "bg-emerald-400",
};

const PET_FACE: Record<PetState, string> = {
  idle: "[:]",
  typing: "[::]",
  success: "[^_^]",
  failure: "[x_x]",
  running: "[o_o]",
  "ci-pass": "[✓]",
};

type PetState = "idle" | "typing" | "success" | "failure" | "running" | "ci-pass";

export function TerminalPet({
  className,
  style,
  onClick,
  title = "Open AI chat (Husk pet)",
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
        className="group relative flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-card/90 p-2.5 shadow-xl backdrop-blur-sm transition hover:scale-105 hover:bg-card"
        title={title}
      >
        <div className="relative inline-flex size-10 items-center justify-center overflow-hidden rounded-lg bg-black/20">
          <span className="font-mono text-xl leading-none text-primary">{PET_FACE[state]}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={cn("size-1.5 rounded-full", PET_DOT[state])} />
        </div>
      </button>
    </div>
  );
}
