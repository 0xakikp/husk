import { useSyncExternalStore } from "react";
import { streamChat } from "./client";
import { getActiveAgent } from "./agents";
import { loadConfig, getKey } from "./store";
import { getProvider } from "./providers";
import { getPrefs } from "../settings/preferences";
import { beginAiRequest, cancelAiRequest, finishAiRequest, isCurrentAiRequest, type AiRequest } from "./requestLifecycle";
import { getAllSessions, updateExistingSession, type AiSession } from "./sessionStore";
import { subscribeTerminalCommandRuns, type ObservedCommandRun } from "./terminalContext";
import { captureTerminalTarget, isCurrentTerminalTarget, type TerminalTarget } from "./terminalTarget";
import { prepareTaskCommandEvidence, prepareTaskFollowupReply } from "./taskFollowupReply";

export type CommandFollowup = {
  id: string;
  sessionId: string;
  ownerId?: string;
  taskId?: string;
  workspacePath?: string;
  remoteScope: string;
  target: TerminalTarget;
  command: string;
  queuedAt: number;
  phase: "waiting" | "ready" | "analyzing" | "paused" | "done";
  note: string;
  completed: boolean;
  result?: ObservedCommandRun;
  resultMessageId?: string;
};

// Runtime only. Reloading/reopening a chat never restarts a command or analysis.
const latest = new Map<string, CommandFollowup>();
const pending = new Map<string, CommandFollowup>();
const requests = new Map<string, AiRequest>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const subscribers = new Set<() => void>();
let observing = false;
const emit = () => subscribers.forEach((fn) => fn());
const sessionFor = (id: string) => getAllSessions().find((session) => session.id === id);
const remoteKey = (session: AiSession) => JSON.stringify(session.remoteWorkspace ?? null);

export const getCommandFollowup = (sessionId: string) => latest.get(sessionId);
export function useCommandFollowup(sessionId: string) {
  return useSyncExternalStore((fn) => { subscribers.add(fn); return () => subscribers.delete(fn); }, () => latest.get(sessionId));
}

function update(id: string, patch: Partial<CommandFollowup>) {
  const entry = [...latest.values()].find((item) => item.id === id);
  if (!entry) return;
  const next = { ...entry, ...patch };
  latest.set(entry.sessionId, next);
  if (pending.has(id)) pending.set(id, next);
  emit();
}

export function pauseCommandFollowup(sessionId: string, note = "Follow-up stopped. A running shell command is not interrupted.") {
  const request = requests.get(sessionId);
  if (request) {
    requests.delete(sessionId);
    cancelAiRequest(request);
    updateExistingSession(sessionId, (session) => ({ ...session, messages: session.messages.map((message) =>
      message.id === request.id ? { ...message, streaming: false, content: message.content || "Result analysis stopped." } : message) }));
  }
  const entry = latest.get(sessionId);
  if (entry && entry.phase !== "done") update(entry.id, { phase: "paused", note });
}

export function commandFollowupScopeMatches(entry: CommandFollowup): boolean {
  const session = sessionFor(entry.sessionId);
  return Boolean(session && session.workspacePath === entry.workspacePath && remoteKey(session) === entry.remoteScope
    && (entry.taskId ? session.task?.id === entry.taskId && session.task.status === "running" : !session.task || session.task.status !== "running")
    && isCurrentTerminalTarget(entry.target));
}

export function trackCommandFollowup(input: {
  sessionId: string; runId?: string; terminalPtyId: number | null; command: string; queuedAt: number;
  target?: TerminalTarget; auto: boolean; ownerId?: string;
}) {
  const session = sessionFor(input.sessionId);
  if (!session || !input.runId || input.terminalPtyId == null) return;
  if (!observing) { subscribeTerminalCommandRuns(observeCommandFollowup); observing = true; }
  pauseCommandFollowup(input.sessionId, "A newer command replaced this follow-up.");
  const auto = input.auto && (!session.task || session.task.status === "running");
  const entry: CommandFollowup = {
    id: input.runId, sessionId: input.sessionId, ownerId: input.ownerId,
    taskId: session.task?.id,
    workspacePath: session.workspacePath, remoteScope: remoteKey(session),
    target: { ...(input.target ?? captureTerminalTarget()) }, command: input.command, queuedAt: input.queuedAt,
    phase: auto ? "waiting" : "paused", completed: false,
    note: auto ? "Waiting for command result…" : "Automatic analysis is paused. The command result will still be added to this chat.",
  };
  latest.set(input.sessionId, entry);
  pending.set(entry.id, entry);
  // Bound retained raw commands even when a terminal never emits completion.
  while (pending.size > 32) {
    const oldest = pending.keys().next().value!;
    clearTimeout(timers.get(oldest)); timers.delete(oldest); pending.delete(oldest);
  }
  timers.set(entry.id, setTimeout(() => {
    timers.delete(entry.id);
    const current = latest.get(entry.sessionId);
    if (current?.id === entry.id && current.phase === "waiting") {
      update(entry.id, { phase: "paused", note: "Completion is not confirmed yet. No automatic follow-up will start; inspect the terminal." });
    }
  }, 90_000));
  emit();
}

/** Unique receipt, not text matching: a later manually typed copy isn't ours. */
export function observeCommandFollowup(run: ObservedCommandRun) {
  const entry = run.runId ? pending.get(run.runId) : undefined;
  if (!entry || run.terminalPtyId !== entry.target.ptyId || run.command.trim() !== entry.command.trim()
    || run.at < entry.queuedAt || (run.startedAt != null && run.startedAt < entry.queuedAt)) return;
  pending.delete(entry.id);
  clearTimeout(timers.get(entry.id)); timers.delete(entry.id);
  const session = sessionFor(entry.sessionId);
  if (!session) return;
  const evidence = prepareTaskCommandEvidence(run, getPrefs().aiContextBudgetKb || 32);
  const resultMessageId = `command-result-${entry.id}`;
  updateExistingSession(entry.sessionId, (current) => current.messages.some((message) => message.id === resultMessageId) ? current : ({
    ...current, messages: [...current.messages, {
      id: resultMessageId, kind: "command-result", role: "user", timestamp: Date.now(),
      content: evidence.ok ? evidence.resultMessage.content : `Command finished. Output was not saved or sent to AI: ${evidence.reason}`,
    }],
  }));
  const current = latest.get(entry.sessionId);
  if (current?.id !== entry.id) return;
  const canAnalyze = evidence.ok && run.exitCode !== null;
  update(entry.id, {
    completed: true, result: canAnalyze ? { ...run } : undefined, resultMessageId,
    phase: canAnalyze && current.phase === "waiting" ? "ready" : "paused",
    note: !evidence.ok ? evidence.reason : run.exitCode === null ? "Exit status is unknown. Inspect the terminal before continuing."
      : current.phase === "waiting" ? "Command finished. Preparing result analysis…" : "Command result added to chat. Automatic analysis is paused.",
  });
}

/** Observer-only: deliberately no tools, action broker or edit-proposal parser. */
export async function analyzeCommandFollowup(sessionId: string, id: string, ownerId?: string) {
  const entry = latest.get(sessionId);
  const session = sessionFor(sessionId);
  if (!entry || entry.id !== id || !entry.result || !session || entry.phase === "analyzing" || entry.phase === "done") return;
  if (!getPrefs().aiEnabled || !commandFollowupScopeMatches(entry)) {
    pauseCommandFollowup(sessionId, "Terminal, workspace or Task changed. Review the saved result in this chat before continuing."); return;
  }
  if (session.input.trim()) {
    pauseCommandFollowup(sessionId, "Your draft takes priority. Send your feedback, or clear it before analyzing the result."); return;
  }
  const request = beginAiRequest(sessionId);
  if (!request) { pauseCommandFollowup(sessionId, "This chat is already responding. Analyze the saved result when it finishes."); return; }
  requests.set(sessionId, request);
  update(id, { phase: "analyzing", ownerId: ownerId ?? entry.ownerId, note: "Reading the command result… Next commands still need Run." });
  try {
    const prepared = prepareTaskFollowupReply({
      objective: entry.taskId ? session.task?.objective : undefined, workspacePath: entry.workspacePath,
      run: entry.result, messages: session.messages.filter((message) => !message.streaming && message.id !== entry.resultMessageId),
      budgetKb: getPrefs().aiContextBudgetKb || 32,
    });
    if (!prepared.ok) { update(id, { phase: "paused", note: prepared.reason }); return; }
    const cfg = loadConfig();
    const provider = getProvider(cfg.providerId);
    const model = getActiveAgent()?.model || cfg.model || provider.defaultModel;
    const apiKey = getKey(provider.id);
    if (!provider.keyless && !apiKey) throw new Error(`Set a ${provider.label} API key in Settings → Models first.`);
    updateExistingSession(sessionId, (current) => ({ ...current, messages: [...current.messages, {
      id: request.id, role: "assistant", content: "", timestamp: Date.now(), streaming: true,
      trace: { providerLabel: provider.label, modelLabel: model, mode: provider.kind === "cli" ? "subscription" : "api",
        workspacePath: entry.workspacePath, workspaceEditAccess: false, workspaceAutoApply: false,
        context: prepared.context, tools: [], historyMessagesOmitted: prepared.historyMessagesOmitted },
    }] }));
    await streamChat({ provider, model, apiKey, baseURL: cfg.baseURL, workspacePath: entry.workspacePath },
      prepared.system, prepared.messages, (delta) => {
        if (!isCurrentAiRequest(request)) return;
        if (!commandFollowupScopeMatches(entry) || !getPrefs().aiEnabled) { pauseCommandFollowup(sessionId, "Context changed; result analysis stopped."); return; }
        updateExistingSession(sessionId, (current) => ({ ...current, messages: current.messages.map((message) =>
          message.id === request.id ? { ...message, content: message.content + delta } : message) }));
      }, undefined, request.controller.signal);
    if (isCurrentAiRequest(request)) {
      if (!commandFollowupScopeMatches(entry) || !getPrefs().aiEnabled) pauseCommandFollowup(sessionId, "Context changed; result analysis stopped.");
      else update(id, { phase: "done", result: undefined, command: "", note: "Result analyzed. Review the suggestion or send feedback; nothing else runs automatically." });
    }
  } catch (error) {
    if (isCurrentAiRequest(request)) update(id, { phase: "paused", note: error instanceof Error ? error.message : "Could not analyze the result. Try again when ready." });
  } finally {
    updateExistingSession(sessionId, (current) => ({ ...current, messages: current.messages.map((message) =>
      message.id === request.id ? { ...message, streaming: false, content: message.content || "No analysis was returned. The command result is saved above." } : message) }));
    finishAiRequest(request);
    if (requests.get(sessionId) === request) requests.delete(sessionId);
  }
}
