import { useEffect, useRef, useState } from "react";
import { useCommandRunning, useActiveTerminalExit } from "../ai/terminalContext";
import { cn } from "../lib/utils";

const PET_ASSETS: Record<string, string> = {
  idle: "/pet/pet-idle.gif",
  typing: "/pet/pet-typing.gif",
  success: "/pet/pet-success.gif",
  failure: "/pet/pet-failure.gif",
  running: "/pet/pet-running.gif",
  "ci-pass": "/pet/pet-ci-pass.gif",
};

type PetState = "idle" | "typing" | "success" | "failure" | "running" | "ci-pass";

export function TerminalPet() {
  const running = useCommandRunning();
  const exitCode = useActiveTerminalExit();
  const [state, setState] = useState<PetState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const messageTimerRef = useRef<number>(0);
  const lastExitRef = useRef<number | null>(null);
  const [typing, setTyping] = useState(false);
  const typingTimerRef = useRef<number>(0);
  const [imgLoaded, setImgLoaded] = useState(true);

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
    const messages: Record<PetState, string> = {
      idle: "Ready to help!",
      typing: "I see you typing...",
      success: "Nice work!",
      failure: "Oops, that failed.",
      running: "Still running...",
      "ci-pass": "All green! 🎉",
    };
    setMessage(messages[state] ?? "Hi!");
    window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(null), 2000);
  };

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 flex flex-col items-end gap-2">
      {message && (
        <div className="max-w-[160px] rounded-lg border border-border/60 bg-card/95 px-2.5 py-1.5 text-[11px] text-foreground shadow-lg">
          {message}
        </div>
      )}
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "relative inline-flex size-14 items-center justify-center overflow-hidden rounded-2xl border border-border/60 bg-card/90 shadow-xl backdrop-blur-sm transition hover:scale-105 hover:bg-card",
          !imgLoaded && "text-2xl"
        )}
        title="Husk pet companion"
      >
        {imgLoaded ? (
          <img
            src={imageUrl}
            alt="Husk companion pet"
            className="size-12 object-contain"
            draggable={false}
            onError={() => setImgLoaded(false)}
          />
        ) : (
          <span>🤖</span>
        )}
      </button>
    </div>
  );
}
