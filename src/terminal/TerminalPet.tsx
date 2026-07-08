import { useEffect, useRef, useState } from "react";
import { useCommandRunning, useActiveTerminalExit } from "../ai/terminalContext";
import { toggleBubble } from "../ai/bubbleStore";
import { cn } from "../lib/utils";
import "./TerminalPet.css";

import idleGif from "../assets/pet/pet-idle.gif";
import typingGif from "../assets/pet/pet-typing.gif";
import successGif from "../assets/pet/pet-success.gif";
import failureGif from "../assets/pet/pet-failure.gif";
import runningGif from "../assets/pet/pet-running.gif";
import ciPassGif from "../assets/pet/pet-ci-pass.gif";

const PET_ASSETS: Record<string, string> = {
  idle: idleGif,
  typing: typingGif,
  success: successGif,
  failure: failureGif,
  running: runningGif,
  "ci-pass": ciPassGif,
};

const PET_LABEL: Record<PetState, string> = {
  idle: "Idle",
  typing: "Typing",
  success: "Success",
  failure: "Failed",
  running: "Running",
  "ci-pass": "CI Pass",
};

const PET_DOT: Record<PetState, string> = {
  idle: "bg-blue-400",
  typing: "bg-yellow-400",
  success: "bg-emerald-400",
  failure: "bg-red-400",
  running: "bg-amber-400",
  "ci-pass": "bg-emerald-400",
};

type PetState = "idle" | "typing" | "success" | "failure" | "running" | "ci-pass";

export function TerminalPet() {
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

  const imageUrl = PET_ASSETS[state];

  const handleClick = () => {
    toggleBubble();
  };

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 flex flex-col items-end gap-2">
      <button
        type="button"
        onClick={handleClick}
        className="group relative flex flex-col items-center gap-1.5 rounded-2xl border border-border/60 bg-card/90 p-2.5 shadow-xl backdrop-blur-sm transition hover:scale-105 hover:bg-card pet-float"
        title="Open AI chat (Husk pet)"
      >
        <div className="relative inline-flex size-16 items-center justify-center overflow-hidden rounded-xl bg-black/20">
          <img
            src={imageUrl}
            alt="Husk companion pet"
            className="size-14 object-contain"
            draggable={false}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", PET_DOT[state])} />
          <span className="text-[9px] font-medium text-muted-foreground">{PET_LABEL[state]}</span>
        </div>
      </button>
    </div>
  );
}
