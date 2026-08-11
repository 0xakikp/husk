import { useCallback, useEffect, useRef, useState } from "react";
import type { Provider } from "../ai/providers";
import { generateOnce } from "../ai/client";
import {
  subscribeTerminalCommandRuns,
  type ObservedCommandRun,
} from "../ai/terminalContext";
import {
  assessTerminalPilotCommand,
  parseTerminalPilotDecision,
  terminalPilotPrompt,
  terminalPilotSystemPrompt,
} from "../ai/terminalPilot";
import { protectedTargets } from "./envSignals";

type PilotStepState = "running" | "complete" | "failed" | "approval";

type PilotStep = {
  id: string;
  command: string;
  reason: string;
  state: PilotStepState;
  exitCode?: number | null;
  output?: string;
  reviewReason?: string;
};

type PilotStatus = "idle" | "planning" | "waiting" | "approval" | "paused" | "complete" | "error";

type PilotRequest = { id: number; task: string } | null;

type TerminalPilotProps = {
  request: PilotRequest;
  provider: Provider;
  model: string;
  apiKey: string;
  baseURL: string;
  cwd: string;
  getTargetPtyId: () => number | null;
  isTerminalRunning: () => boolean;
  runInTargetTerminal: (command: string) => boolean;
};

const MAX_STEPS = 8;

function stepId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function outputPreview(output: string | undefined): string {
  if (!output) return "No output returned.";
  return output.length > 1_500 ? `…${output.slice(-1_500)}` : output;
}

/** A supervised, single-terminal execution loop. This component intentionally
 * owns no shell access: the parent supplies the active terminal runner, and
 * every command is still typed into the visible terminal the user selected. */
export function TerminalPilot({
  request,
  provider,
  model,
  apiKey,
  baseURL,
  cwd,
  getTargetPtyId,
  isTerminalRunning,
  runInTargetTerminal,
}: TerminalPilotProps) {
  const [status, setStatus] = useState<PilotStatus>("idle");
  const [task, setTask] = useState("");
  const [steps, setSteps] = useState<PilotStep[]>([]);
  const [note, setNote] = useState("");
  const requestRef = useRef(0);
  const targetPtyRef = useRef<number | null>(null);
  const waitingCommandRef = useRef<string | null>(null);
  const waitTimerRef = useRef<number | null>(null);
  const currentTaskRef = useRef("");
  const stepsRef = useRef<PilotStep[]>([]);
  const stoppedRef = useRef(false);

  useEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const setPilotState = useCallback((nextStatus: PilotStatus, nextNote = "") => {
    setStatus(nextStatus);
    setNote(nextNote);
  }, []);

  const updateStep = useCallback((id: string, patch: Partial<PilotStep>) => {
    setSteps((current) => {
      const next = current.map((step) => step.id === id ? { ...step, ...patch } : step);
      stepsRef.current = next;
      return next;
    });
  }, []);

  const clearWaitTimer = useCallback(() => {
    if (waitTimerRef.current != null) window.clearTimeout(waitTimerRef.current);
    waitTimerRef.current = null;
  }, []);

  const execute = useCallback((step: PilotStep) => {
    if (stoppedRef.current) return;
    if (targetPtyRef.current == null) {
      setPilotState("paused", "The selected terminal is no longer available. Start a new Pilot session from the terminal you want to use.");
      return;
    }
    if (getTargetPtyId() !== targetPtyRef.current) {
      setPilotState("paused", "Terminal focus changed. Return to the Pilot terminal before continuing so no command lands in another session.");
      return;
    }
    if (isTerminalRunning()) {
      setPilotState("paused", "The terminal is busy. Wait for its current command to finish, then start a new Pilot session.");
      return;
    }
    waitingCommandRef.current = step.command.trim();
    clearWaitTimer();
    updateStep(step.id, { state: "running" });
    setPilotState("waiting", "Running in the visible terminal…");
    if (!runInTargetTerminal(step.command)) {
      waitingCommandRef.current = null;
      updateStep(step.id, { state: "approval", reviewReason: "Husk could not send this command to the selected terminal." });
      setPilotState("paused", "Husk could not send the command. Check that the terminal is open and focused.");
      return;
    }
    waitTimerRef.current = window.setTimeout(() => {
      if (waitingCommandRef.current !== step.command.trim()) return;
      stoppedRef.current = true;
      setPilotState("paused", "Pilot is still waiting for this terminal command. No further command will run automatically; inspect the terminal, then start a new Pilot task if needed.");
    }, 90_000);
  }, [clearWaitTimer, getTargetPtyId, isTerminalRunning, runInTargetTerminal, setPilotState, updateStep]);

  const advance = useCallback(async (history: PilotStep[]) => {
    if (stoppedRef.current) return;
    if (history.length >= MAX_STEPS) {
      setPilotState("paused", `Pilot reached the ${MAX_STEPS}-step diagnostic limit. Review the visible evidence before continuing manually.`);
      return;
    }
    setPilotState("planning", "Reading the observed result and choosing one next step…");
    try {
      const response = await generateOnce(
        { provider, model, apiKey, baseURL, workspacePath: cwd || undefined },
        terminalPilotSystemPrompt(),
        terminalPilotPrompt({
          task: currentTaskRef.current,
          cwd,
          steps: history.map((step) => ({
            command: step.command,
            exitCode: step.exitCode ?? null,
            output: step.output ?? "",
          })),
        }),
      );
      if (stoppedRef.current) return;
      const decision = parseTerminalPilotDecision(response);
      if (!decision) {
        setPilotState("paused", "Pilot received an invalid next-step response and stopped before running anything else.");
        return;
      }
      if (decision.action === "done") {
        setPilotState("complete", decision.summary);
        return;
      }
      if (decision.action === "ask") {
        setPilotState("paused", decision.summary);
        return;
      }

      const safety = assessTerminalPilotCommand(decision.command, protectedTargets());
      const nextStep: PilotStep = {
        id: stepId(),
        command: decision.command,
        reason: decision.reason,
        state: safety.kind === "safe" ? "running" : "approval",
        ...(safety.kind === "review" ? { reviewReason: safety.reason } : {}),
      };
      const nextHistory = [...history, nextStep];
      stepsRef.current = nextHistory;
      setSteps(nextHistory);
      if (safety.kind === "review") {
        setPilotState("approval", `Review required: ${safety.reason}.`);
      } else {
        /* Let React commit the new step before it changes state again. */
        window.setTimeout(() => execute(nextStep), 0);
      }
    } catch (error) {
      if (stoppedRef.current) return;
      setPilotState("error", error instanceof Error ? error.message : String(error));
    }
  }, [apiKey, baseURL, cwd, execute, model, provider, setPilotState]);

  useEffect(() => {
    return subscribeTerminalCommandRuns((run: ObservedCommandRun) => {
      const waiting = waitingCommandRef.current;
      if (!waiting || targetPtyRef.current == null) return;
      if (run.terminalPtyId !== targetPtyRef.current || run.command.trim() !== waiting) return;

      waitingCommandRef.current = null;
      clearWaitTimer();
      const completed = stepsRef.current.map((step) => step.command.trim() === waiting && step.state === "running"
        ? { ...step, state: run.exitCode === 0 ? "complete" as const : "failed" as const, exitCode: run.exitCode, output: run.output }
        : step);
      stepsRef.current = completed;
      setSteps(completed);
      if (stoppedRef.current) return;
      /* Registry clears its running state after publishing the command event.
         Scheduling avoids racing the next command into that final cleanup. */
      window.setTimeout(() => void advance(completed), 80);
    });
  }, [advance, clearWaitTimer]);

  useEffect(() => {
    if (!request || request.id === requestRef.current) return;
    requestRef.current = request.id;
    if (isTerminalRunning()) {
      setPilotState("paused", "The selected terminal is busy. Wait for it to finish before starting Pilot.");
      return;
    }
    const target = getTargetPtyId();
    if (target == null) {
      setPilotState("error", "Open and focus a terminal before starting Terminal Pilot.");
      return;
    }
    stoppedRef.current = false;
    targetPtyRef.current = target;
    waitingCommandRef.current = null;
    clearWaitTimer();
    currentTaskRef.current = request.task;
    setTask(request.task);
    setSteps([]);
    void advance([]);
  }, [advance, clearWaitTimer, getTargetPtyId, isTerminalRunning, provider.kind, request, setPilotState]);

  useEffect(() => () => {
    stoppedRef.current = true;
    waitingCommandRef.current = null;
    clearWaitTimer();
  }, [clearWaitTimer]);

  if (status === "idle") return null;
  const awaitingApproval = status === "approval";
  const proposed = steps.find((step) => step.state === "approval");
  const running = status === "planning" || status === "waiting";

  return (
    <section className="terminal-pilot" aria-live="polite">
      <div className="terminal-pilot-head">
        <span className="terminal-pilot-dot" aria-hidden="true">●</span>
        <strong>TERMINAL PILOT</strong>
        <span className="terminal-pilot-mode">{provider.kind === "cli" ? "CLI PLAN" : "API PLAN"}</span>
        <span className={`terminal-pilot-state is-${status}`}>{status === "waiting" ? "LIVE" : status}</span>
        <span className="terminal-pilot-spacer" />
        {!running && status !== "complete" && (
          <button type="button" className="terminal-pilot-btn" onClick={() => {
            stoppedRef.current = true;
            waitingCommandRef.current = null;
            clearWaitTimer();
            setPilotState("idle");
          }}>
            close
          </button>
        )}
        {(running || awaitingApproval || status === "paused") && (
          <button type="button" className="terminal-pilot-btn" onClick={() => {
            stoppedRef.current = true;
            waitingCommandRef.current = null;
            clearWaitTimer();
            setPilotState("paused", "Pilot paused. The terminal command, if any, remains visible and under your control.");
          }}>
            pause
          </button>
        )}
      </div>
      <p className="terminal-pilot-task">{task}</p>
      <div className="terminal-pilot-steps">
        {steps.map((step, index) => (
          <article key={step.id} className={`terminal-pilot-step is-${step.state}`}>
            <span className="terminal-pilot-step-number">{String(index + 1).padStart(2, "0")}</span>
            <div className="min-w-0 flex-1">
              <code>{step.command}</code>
              <p>{step.reason}</p>
              {step.output !== undefined && <pre>{outputPreview(step.output)}</pre>}
              {step.reviewReason && <small>Approval needed: {step.reviewReason}</small>}
            </div>
            <span className="terminal-pilot-step-result">
              {step.state === "running" ? "running" : step.state === "approval" ? "review" : `exit ${step.exitCode ?? "?"}`}
            </span>
          </article>
        ))}
      </div>
      {note && <p className="terminal-pilot-note">{note}</p>}
      {awaitingApproval && proposed && (
        <div className="terminal-pilot-actions">
          <button type="button" className="terminal-pilot-btn" onClick={() => {
            stoppedRef.current = true;
            clearWaitTimer();
            setPilotState("paused", "Command was not run. You can run it yourself from the visible proposal or start a new Pilot task.");
          }}>
            skip
          </button>
          <button type="button" className="terminal-pilot-btn is-approve" onClick={() => execute(proposed)}>
            approve & run
          </button>
        </div>
      )}
      {status === "complete" && (
        <div className="terminal-pilot-actions">
          <button type="button" className="terminal-pilot-btn" onClick={() => {
            stoppedRef.current = true;
            clearWaitTimer();
            setPilotState("idle");
          }}>
            close
          </button>
        </div>
      )}
    </section>
  );
}

export function terminalPilotAvailability(provider: Provider): string {
  return provider.kind === "cli"
    ? "Plan with your signed-in CLI; Husk still executes only supervised terminal steps"
    : "Run a supervised diagnostic from this request";
}
