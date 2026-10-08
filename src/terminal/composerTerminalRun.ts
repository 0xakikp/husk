import { getActiveTerminalCwd, getActiveTerminalPtyId, runInActiveTerminalResult, type TerminalRunFailureReason } from "../ai/terminalContext";
import { isVerificationCommand, taskCommandFingerprint, type AiTaskEvent, type AiTaskState } from "../ai/taskMode";
import { safeTimelineCommand } from "../timeline/commandMetadata";
import { toast } from "../toast";

const TERMINAL_RUN_FAILURES: Record<TerminalRunFailureReason, { title: string; message: string; variant: "info" | "warning" | "error" }> = {
  "no-terminal": {
    title: "No active terminal",
    message: "Open and focus a terminal before running a command from Husk.",
    variant: "error",
  },
  "terminal-unavailable": {
    title: "Terminal is not ready",
    message: "The terminal connection is not ready. Wait for it to recover and check the prompt before trying again.",
    variant: "warning",
  },
  "terminal-busy": {
    title: "Terminal is busy",
    message: "Wait for the current command to finish, or copy this command to run it yourself.",
    variant: "info",
  },
  "input-present": {
    title: "Terminal input is waiting",
    message: "Husk did not run this command because it could join text already at the prompt. Clear or submit that input, then try again.",
    variant: "warning",
  },
  "prompt-unverified": {
    title: "Shell prompt is not verified",
    message: "Husk cannot verify an empty shell prompt. Return to a fresh prompt or copy the command instead.",
    variant: "warning",
  },
  "write-failed": {
    title: "Could not send command",
    message: "The terminal write failed. Check the prompt before trying again; input may have been partially sent.",
    variant: "error",
  },
};

export function notifyTerminalFolderUnavailable(): void {
  toast(getActiveTerminalPtyId() === null
    ? TERMINAL_RUN_FAILURES["no-terminal"]
    : {
      title: "Terminal folder is unknown",
      message: "Husk cannot verify this terminal's working folder. Return to a fresh shell prompt before running this workspace command.",
      variant: "warning",
    });
}

/** Shared by normal chat, TASK, and supervised terminal steps. Refused input
 * never creates a running task event or a success notice. */
export function runComposerTerminalCommand(command: string, options: {
  destinationCwd?: string;
  evidenceCommand?: string;
  task?: AiTaskState;
  onTaskEvent: (taskId: string, event: AiTaskEvent) => void;
  onAccepted?: (receipt: { runId?: string; terminalPtyId: number | null; command: string; queuedAt: number }) => void;
}): boolean {
  const cmd = command.trim();
  if (!cmd) return false;
  const terminalPtyId = getActiveTerminalPtyId();
  const cwd = options.destinationCwd || getActiveTerminalCwd();
  const queuedAt = Date.now();
  const result = runInActiveTerminalResult(cmd);
  if (!result.ok) {
    toast({ ...TERMINAL_RUN_FAILURES[result.reason], ...(result.message ? { message: result.message } : {}) });
    return false;
  }
  if (options.task?.status === "running") {
    const evidence = options.evidenceCommand ?? command;
    const safe = safeTimelineCommand(evidence);
    const type = isVerificationCommand(evidence) ? "check" : "command";
    const now = Date.now();
    options.onTaskEvent(options.task.id, {
      id: `${type}-${now}-${Math.random().toString(36).slice(2, 7)}`,
      type, label: safe.display, state: "running", at: now, startedAt: now,
      detail: cwd || undefined,
      ...(safe.command ? { command: safe.command } : {}),
      commandFingerprint: taskCommandFingerprint(cmd), terminalPtyId,
      terminalRunId: result.runId,
    });
  }
  options.onAccepted?.({ runId: result.runId, terminalPtyId, command: cmd, queuedAt });
  toast({
    title: "Command sent to terminal",
    message: cwd ? `Running in ${cwd}` : "Running in the active terminal",
    variant: "info", duration: 2200,
  });
  return true;
}
