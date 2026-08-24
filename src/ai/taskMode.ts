export type AiTaskStatus = "running" | "paused" | "completed" | "stopped";
export type AiTaskEventType =
  | "scope"
  | "project"
  | "request"
  | "response"
  | "tool"
  | "edit-proposed"
  | "edit-applied"
  | "command"
  | "check";
export type AiTaskEventState = "running" | "complete" | "failed" | "review" | "info";

export type AiTaskEvent = {
  id: string;
  type: AiTaskEventType;
  label: string;
  state: AiTaskEventState;
  at: number;
  detail?: string;
  command?: string;
  commandFingerprint?: string;
  terminalPtyId?: number | null;
  exitCode?: number | null;
};

export type AiTaskState = {
  id: string;
  objective: string;
  workspacePath: string;
  status: AiTaskStatus;
  createdAt: number;
  updatedAt: number;
  events: AiTaskEvent[];
};

export type AiTaskStageState = "pending" | "active" | "review" | "complete" | "failed";

export type AiTaskStage = {
  id: "context" | "work" | "changes" | "verify";
  label: string;
  state: AiTaskStageState;
  detail: string;
};

const MAX_TASK_EVENTS = 48;

function makeId(prefix: string, now = Date.now()): string {
  return `${prefix}-${now}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createAiTask(
  objective: string,
  workspacePath: string,
  options?: { projectReady?: boolean; now?: number },
): AiTaskState {
  const now = options?.now ?? Date.now();
  const events: AiTaskEvent[] = [{
    id: makeId("scope", now),
    type: "scope",
    label: "Workspace pinned",
    state: "complete",
    at: now,
    detail: workspacePath,
  }];
  if (options?.projectReady) {
    events.push({
      id: makeId("project", now + 1),
      type: "project",
      label: "Project Lens ready",
      state: "complete",
      at: now + 1,
    });
  }
  return {
    id: makeId("task", now),
    objective: objective.trim().slice(0, 2_000),
    workspacePath,
    status: "running",
    createdAt: now,
    updatedAt: now,
    events,
  };
}

export function appendAiTaskEvent(task: AiTaskState, event: AiTaskEvent): AiTaskState {
  const existing = task.events.findIndex((item) => item.id === event.id);
  const events = [...task.events];
  if (existing >= 0) events[existing] = { ...events[existing], ...event };
  else events.push(event);
  return {
    ...task,
    updatedAt: Math.max(task.updatedAt, event.at),
    events: events.slice(-MAX_TASK_EVENTS),
  };
}

export function setAiTaskStatus(task: AiTaskState, status: AiTaskStatus, now = Date.now()): AiTaskState {
  return { ...task, status, updatedAt: now };
}

/** Running work cannot safely continue by itself after an application restart. */
export function restoreAiTask(raw: unknown, now = Date.now()): AiTaskState | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<AiTaskState>;
  if (
    typeof value.id !== "string"
    || typeof value.objective !== "string"
    || typeof value.workspacePath !== "string"
    || typeof value.createdAt !== "number"
  ) return undefined;
  const status: AiTaskStatus = value.status === "running"
    ? "paused"
    : value.status === "paused" || value.status === "completed" || value.status === "stopped"
      ? value.status
      : "paused";
  const events = Array.isArray(value.events)
    ? value.events.filter((event): event is AiTaskEvent => Boolean(event) && typeof event.id === "string" && typeof event.label === "string").slice(-MAX_TASK_EVENTS)
    : [];
  return {
    id: value.id,
    objective: value.objective,
    workspacePath: value.workspacePath,
    createdAt: value.createdAt,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : now,
    status,
    events,
  };
}

export function isVerificationCommand(command: string): boolean {
  const value = command.trim().toLowerCase();
  return /^(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|build|lint|check|typecheck)\b/.test(value)
    || /^(?:cargo\s+(?:test|check|clippy)|pytest\b|python\s+-m\s+pytest\b|go\s+test\b|mvn\s+(?:test|verify)\b|gradle\w*\s+(?:test|check|build)\b)/.test(value)
    || /^(?:make|just)\s+(?:test|check|lint|build)\b/.test(value);
}

/** Match a command-completion event without persisting the raw command. This
 * is deliberately only an identity token: display text still goes through
 * Husk's secret scanner before it enters a saved task. */
export function taskCommandFingerprint(command: string): string {
  const value = command.trim().replace(/\s+/g, " ");
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function deriveAiTaskStages(task: AiTaskState): AiTaskStage[] {
  const hasProject = task.events.some((event) => event.type === "project" && event.state === "complete");
  const hasScope = Boolean(task.workspacePath);
  const requests = task.events.filter((event) => event.type === "request").length;
  const tools = task.events.filter((event) => event.type === "tool" && event.state === "complete").length;
  const responses = task.events.filter((event) => event.type === "response" && event.state === "complete").length;
  const proposed = task.events.filter((event) => event.type === "edit-proposed" && event.state === "review").length;
  const applied = task.events.filter((event) => event.type === "edit-applied" && event.state === "complete").length;
  const checks = task.events.filter((event) => event.type === "check");
  const newestCheck = (state: AiTaskEventState) => [...checks].reverse().find((event) => event.state === state);
  const failedCheck = newestCheck("failed");
  const passedCheck = newestCheck("complete");
  const runningCheck = newestCheck("running");

  const contextState: AiTaskStageState = hasProject || hasScope ? "complete" : task.status === "running" ? "active" : "pending";
  const workState: AiTaskStageState = task.status === "completed"
    ? "complete"
    : requests > 0 || tools > 0 || responses > 0
      ? "active"
      : "pending";
  const changesState: AiTaskStageState = proposed > 0
    ? "review"
    : applied > 0
      ? "complete"
      : "pending";
  const verifyState: AiTaskStageState = runningCheck
    ? "active"
    : failedCheck && (!passedCheck || failedCheck.at > passedCheck.at)
      ? "failed"
      : passedCheck
        ? "complete"
        : "pending";

  return [
    { id: "context", label: "Context", state: contextState, detail: hasProject ? "Project Lens ready" : "Workspace pinned" },
    { id: "work", label: "Work", state: workState, detail: tools ? `${tools} Husk action${tools === 1 ? "" : "s"}` : responses ? `${responses} response${responses === 1 ? "" : "s"}` : requests ? "AI working" : "Not started" },
    { id: "changes", label: "Changes", state: changesState, detail: proposed ? `${proposed} to review` : applied ? `${applied} applied` : "No file changes" },
    { id: "verify", label: "Checks", state: verifyState, detail: runningCheck?.label ?? (failedCheck && (!passedCheck || failedCheck.at > passedCheck.at) ? `${failedCheck.label} failed` : passedCheck ? `${passedCheck.label} passed` : "Not run") },
  ];
}

export function taskProgress(task: AiTaskState): number {
  const weights: Record<AiTaskStageState, number> = { pending: 0, active: 0.5, review: 0.65, complete: 1, failed: 0.75 };
  const stages = deriveAiTaskStages(task);
  return Math.round((stages.reduce((sum, stage) => sum + weights[stage.state], 0) / stages.length) * 100);
}

export function taskModeSystemContext(task: AiTaskState): string {
  return [
    "You are working inside Husk Task Mode: a supervised task, not an autonomous background agent.",
    `Task objective: ${task.objective}`,
    `Pinned workspace: ${task.workspacePath}`,
    "Keep progress grounded in confirmed Husk tool results and visible terminal output.",
    "Use the smallest useful next action. Never claim a command ran, a check passed, or a file changed unless Husk returned evidence.",
    "File changes remain reviewable and commands remain subject to Husk's workspace, draft-input, protected-target, and dangerous-command gates.",
    "Briefly state what was established, what remains, and the next safe step. Do not manufacture completion percentages or hidden work.",
  ].join("\n");
}
