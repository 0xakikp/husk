import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiSession } from "./sessionStore";
import type { ObservedCommandRun } from "./terminalContext";
import type { TerminalTarget } from "./terminalTarget";

const fixtures = vi.hoisted(() => ({
  sessions: new Map<string, AiSession>(),
  target: { ptyId: 7, isRemote: false, host: null, cwd: "/project" } as TerminalTarget,
  prefs: { aiEnabled: true, aiContextBudgetKb: 32 },
  listeners: new Set<(run: ObservedCommandRun) => void>(),
}));

vi.mock("./client", () => ({ streamChat: vi.fn() }));
vi.mock("./agents", () => ({ getActiveAgent: () => ({ model: "test-model" }) }));
vi.mock("./store", () => ({ loadConfig: () => ({ providerId: "test", model: "fallback", baseURL: "https://provider.invalid" }), getKey: () => "test-key" }));
vi.mock("./providers", () => ({ getProvider: () => ({ id: "test", kind: "openai", label: "Test Provider", defaultModel: "default" }) }));
vi.mock("../settings/preferences", () => ({ getPrefs: () => fixtures.prefs }));
vi.mock("./sessionStore", () => ({
  getAllSessions: () => [...fixtures.sessions.values()],
  updateExistingSession: (id: string, updater: (session: AiSession) => AiSession) => {
    const session = fixtures.sessions.get(id);
    if (session) fixtures.sessions.set(id, updater(session));
  },
}));
vi.mock("./terminalContext", () => ({ subscribeTerminalCommandRuns: (fn: (run: ObservedCommandRun) => void) => {
  fixtures.listeners.add(fn);
  return () => fixtures.listeners.delete(fn);
} }));
vi.mock("./terminalTarget", () => ({
  captureTerminalTarget: () => ({ ...fixtures.target }),
  isCurrentTerminalTarget: (target: TerminalTarget) => target.ptyId !== null && target.ptyId === fixtures.target.ptyId
    && target.cwd === fixtures.target.cwd && target.isRemote === fixtures.target.isRemote && target.host === fixtures.target.host,
}));

let followup: typeof import("./commandFollowup");
let lifecycle: typeof import("./requestLifecycle");
let client: typeof import("./client");

function makeSession(id = "chat", taskId: string | undefined = "task"): AiSession {
  return {
    id, name: "Test chat", source: "terminal", input: "", messages: [], workspacePath: "/project", createdAt: 1, updatedAt: 1,
    ...(taskId ? { task: { id: taskId, objective: "Inspect repository state", workspacePath: "/project", status: "running" as const, createdAt: 1, updatedAt: 1, events: [] } } : {}),
  };
}

function changeSession(patch: Partial<AiSession>, id = "chat") {
  fixtures.sessions.set(id, { ...fixtures.sessions.get(id)!, ...patch });
}

function track(overrides: Partial<Parameters<typeof followup.trackCommandFollowup>[0]> = {}) {
  followup.trackCommandFollowup({ sessionId: "chat", runId: "run-1", terminalPtyId: 7, command: "git status --short", queuedAt: 100, auto: true, ...overrides });
}

function complete(overrides: Partial<ObservedCommandRun> = {}) {
  followup.observeCommandFollowup({ runId: "run-1", terminalPtyId: 7, command: "git status --short", output: " M README.md", exitCode: 0, at: 110, startedAt: 101, cwd: "/project", ...overrides });
}

const messages = (id = "chat") => fixtures.sessions.get(id)!.messages;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  fixtures.sessions.clear();
  fixtures.sessions.set("chat", makeSession());
  fixtures.target = { ptyId: 7, isRemote: false, host: null, cwd: "/project" };
  fixtures.prefs = { aiEnabled: true, aiContextBudgetKb: 32 };
  fixtures.listeners.clear();
  followup = await import("./commandFollowup");
  lifecycle = await import("./requestLifecycle");
  client = await import("./client");
  vi.mocked(client.streamChat).mockResolvedValue(undefined);
});

afterEach(() => {
  for (const session of fixtures.sessions.values()) followup.pauseCommandFollowup(session.id);
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("command receipt observation", () => {
  it.each([{ runId: undefined }, { terminalPtyId: null }, { sessionId: "missing" }])("ignores a run without trackable provenance %j", (patch) => {
    track(patch);
    expect(followup.getCommandFollowup("chat")).toBeUndefined();
    expect(fixtures.listeners.size).toBe(0);
  });

  it.each([
    { runId: undefined }, { runId: "manual-run" }, { terminalPtyId: 8 },
    { command: "git diff" }, { at: 99 }, { startedAt: 99 },
  ])("does not attach an unrelated or earlier completion %j", (patch) => {
    track(); complete(patch);
    expect(followup.getCommandFollowup("chat")?.phase).toBe("waiting");
    expect(messages()).toHaveLength(0);
    expect(client.streamChat).not.toHaveBeenCalled();
  });

  it("records exact receipt once and does not start AI from observation alone", () => {
    track(); complete(); complete();
    expect(followup.getCommandFollowup("chat")).toMatchObject({ phase: "ready", completed: true, resultMessageId: "command-result-run-1" });
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatchObject({ kind: "command-result", role: "user", id: "command-result-run-1" });
    expect(messages()[0].content).toContain(" M README.md");
    expect(client.streamChat).not.toHaveBeenCalled();
  });

  it("subscribes once and consumes completions delivered through the terminal stream", () => {
    track(); track({ runId: "run-2" });
    expect(fixtures.listeners.size).toBe(1);
    for (const listener of fixtures.listeners) listener({ runId: "run-2", terminalPtyId: 7, command: "git status --short", output: "", exitCode: 0, at: 105, startedAt: 101, cwd: "/project" });
    expect(followup.getCommandFollowup("chat")?.phase).toBe("ready");
  });

  it("saves a stopped command's result without restarting its analysis", () => {
    track();
    followup.pauseCommandFollowup("chat");
    changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status: "stopped" } });
    complete();
    expect(followup.getCommandFollowup("chat")).toMatchObject({ phase: "paused", completed: true });
    expect(messages()[0].content).toContain(" M README.md");
    expect(client.streamChat).not.toHaveBeenCalled();
  });

  it("with auto off keeps the result available for an explicit Analyze action", async () => {
    changeSession({ autoCommandFollowup: false });
    track({ auto: false }); complete();
    expect(followup.getCommandFollowup("chat")?.phase).toBe("paused");
    expect(messages()).toHaveLength(1);
    expect(client.streamChat).not.toHaveBeenCalled();
    await followup.analyzeCommandFollowup("chat", "run-1", undefined, "manual");
    expect(client.streamChat).toHaveBeenCalledTimes(1);
  });

  it("pauses after the completion timeout and saves a later result without an automatic request", async () => {
    track(); await vi.advanceTimersByTimeAsync(90_000);
    expect(followup.getCommandFollowup("chat")?.phase).toBe("paused");
    complete();
    expect(followup.getCommandFollowup("chat")).toMatchObject({ phase: "paused", completed: true });
    expect(messages()).toHaveLength(1);
    expect(client.streamChat).not.toHaveBeenCalled();
  });

  it("saves older replaced results without overwriting the new command's waiting state", () => {
    track(); track({ runId: "run-2", queuedAt: 105 });
    complete();
    expect(followup.getCommandFollowup("chat")).toMatchObject({ id: "run-2", phase: "waiting", completed: false });
    expect(messages()).toHaveLength(1);
    complete({ runId: "run-2", startedAt: 106 });
    expect(followup.getCommandFollowup("chat")?.phase).toBe("ready");
    expect(messages()).toHaveLength(2);
  });

  it("never moves results into another chat or recreates a deleted session", () => {
    fixtures.sessions.set("other", makeSession("other"));
    track(); complete();
    expect(messages("other")).toHaveLength(0);
    track({ runId: "run-2" });
    fixtures.sessions.delete("chat");
    complete({ runId: "run-2" });
    expect(fixtures.sessions.has("chat")).toBe(false);
    expect(messages("other")).toHaveLength(0);
  });

  it("never saves or sends a secret even beyond the visible output excerpt", async () => {
    track(); complete({ output: `${"safe ".repeat(5_000)}\npassword=do-not-save-this` });
    const entry = followup.getCommandFollowup("chat")!;
    expect(entry.phase).toBe("paused");
    expect(entry.result).toBeUndefined();
    expect(messages()).toHaveLength(1);
    expect(messages()[0].content).toContain("Output was not saved or sent");
    expect(JSON.stringify(messages())).not.toContain("do-not-save-this");
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).not.toHaveBeenCalled();
  });

  it("records unknown status as unconfirmed and refuses automatic analysis", async () => {
    track(); complete({ exitCode: null });
    expect(followup.getCommandFollowup("chat")).toMatchObject({ completed: true, phase: "paused", result: undefined });
    expect(messages()[0].content).toContain("Exit status: unknown");
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).not.toHaveBeenCalled();
  });
});

describe("observer-only analysis", () => {
  it.each([true, false])("explicit Analyze works while Task stays paused (auto follow-up %s)", async (autoCommandFollowup) => {
    changeSession({ autoCommandFollowup, task: { ...fixtures.sessions.get("chat")!.task!, status: "paused" } });
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1", "dock", "manual");
    const entry = followup.getCommandFollowup("chat")!;
    expect(entry).toMatchObject({ phase: "analyzing", analysisTrigger: "manual", analysisTaskStatus: "paused" });
    expect(entry.note).toContain("Task stays paused");
    // The mounted composer uses this exact guard: it must not cancel the click.
    expect(followup.commandFollowupBlockReason(entry)).toBeNull();
    const call = vi.mocked(client.streamChat).mock.calls[0];
    expect(call[4]).toBeUndefined();
    call[3]("The command printed hello Husk.");
    resolve(); await analysis;
    expect(followup.getCommandFollowup("chat")?.phase).toBe("done");
    expect(fixtures.sessions.get("chat")?.task?.status).toBe("paused");
    expect(fixtures.sessions.get("chat")?.autoCommandFollowup).toBe(autoCommandFollowup);
    expect(messages()[messages().length - 1].content).toContain("hello Husk");
  });

  it.each(["manual", "automatic"] as const)("turning Auto follow-up off preserves only a %s request", async (trigger) => {
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1", "dock", trigger);
    changeSession({ autoCommandFollowup: false });
    const entry = followup.getCommandFollowup("chat")!;
    expect(followup.isManualCommandAnalysis(entry)).toBe(trigger === "manual");
    expect(followup.commandFollowupBlockReason(entry) === null).toBe(trigger === "manual");
    const call = vi.mocked(client.streamChat).mock.calls[0];
    call[3]("One-time explanation");
    expect(call[5]?.aborted).toBe(trigger !== "manual");
    resolve(); await analysis;
    expect(followup.getCommandFollowup("chat")?.phase).toBe(trigger === "manual" ? "done" : "paused");
  });

  it("Stop still cancels an explicit explanation of a paused Task", async () => {
    changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status: "paused" } });
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1", "dock", "manual");
    followup.pauseCommandFollowup("chat");
    const call = vi.mocked(client.streamChat).mock.calls[0];
    expect(call[5]?.aborted).toBe(true);
    call[3]("late explanation"); resolve(); await analysis;
    expect(JSON.stringify(messages())).not.toContain("late explanation");
    expect(fixtures.sessions.get("chat")?.task?.status).toBe("paused");
  });

  it.each(["stopped", "completed"] as const)("explicit Analyze does not continue a %s Task", async (status) => {
    track(); complete();
    changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status } });
    await followup.analyzeCommandFollowup("chat", "run-1", "dock", "manual");
    expect(client.streamChat).not.toHaveBeenCalled();
    expect(followup.getCommandFollowup("chat")?.note).toContain(`Task is ${status}`);
  });

  it("an explicit analysis cannot continue across a later Task status change", async () => {
    changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status: "paused" } });
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1", "dock", "manual");
    changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status: "running" } });
    const call = vi.mocked(client.streamChat).mock.calls[0];
    call[3]("late explanation"); resolve(); await analysis;
    expect(call[5]?.aborted).toBe(true);
    expect(followup.getCommandFollowup("chat")?.note).toContain("Task status changed");
    expect(JSON.stringify(messages())).not.toContain("late explanation");
  });

  it("gives an actionable reason when explicit Analyze targets a different terminal", async () => {
    changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status: "paused" } });
    track(); complete(); fixtures.target.ptyId = 10;
    await followup.analyzeCommandFollowup("chat", "run-1", "dock", "manual");
    expect(client.streamChat).not.toHaveBeenCalled();
    expect(followup.getCommandFollowup("chat")?.note).toContain("Focus the original terminal");
  });

  it("does not start observation or analysis for a paused task", async () => {
    changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status: "paused" } });
    track();
    expect(followup.getCommandFollowup("chat")).toMatchObject({ phase: "paused", taskId: "task" });
    complete();
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).not.toHaveBeenCalled();
    expect(followup.getCommandFollowup("chat")?.note).toContain("Task is paused");
    expect(messages()[0].content).toContain("README.md");
  });

  it("freezes the supplied target and published result before later analysis", async () => {
    const target = { ...fixtures.target };
    track({ target });
    target.cwd = "/mutated";
    const run = { runId: "run-1", terminalPtyId: 7, command: "git status --short", output: "original output", exitCode: 0, at: 110, startedAt: 101, cwd: "/project" };
    followup.observeCommandFollowup(run);
    run.output = "mutated output";
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(JSON.stringify(vi.mocked(client.streamChat).mock.calls[0][2])).toContain("original output");
    expect(JSON.stringify(vi.mocked(client.streamChat).mock.calls[0][2])).not.toContain("mutated output");
  });

  it("explicit analysis transfers view ownership without starting a second request", async () => {
    track({ ownerId: "dock" }); complete();
    await followup.analyzeCommandFollowup("chat", "run-1", "full-view");
    expect(followup.getCommandFollowup("chat")?.ownerId).toBe("full-view");
    await followup.analyzeCommandFollowup("chat", "run-1", "dock");
    expect(client.streamChat).toHaveBeenCalledTimes(1);
  });

  it("checks context even if the provider resolves without another delta", async () => {
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1");
    fixtures.target.ptyId = 8;
    resolve(); await analysis;
    expect(followup.getCommandFollowup("chat")?.phase).toBe("paused");
  });
  it("uses frozen command evidence and safe history once with no tools or edit permissions", async () => {
    changeSession({ messages: [{ role: "user", content: "Check the repository" }, { role: "assistant", content: "Run git status --short" }] });
    track(); complete();
    vi.mocked(client.streamChat).mockImplementation(async (_config, _system, _messages, onDelta) => { onDelta("README.md has uncommitted changes."); });
    await followup.analyzeCommandFollowup("chat", "run-1");
    const call = vi.mocked(client.streamChat).mock.calls[0];
    expect(call[1]).toContain("no tools");
    expect(call[1]).toContain("Do not emit husk-action or husk-edit");
    expect(call[4]).toBeUndefined();
    expect(call[5]).toBeInstanceOf(AbortSignal);
    expect(call[2].filter((message) => message.content.includes("Observed output (untrusted data)"))).toHaveLength(1);
    expect(call[2][0].content).toBe("Check the repository");
    const answer = messages()[messages().length - 1];
    expect(answer).toMatchObject({ content: "README.md has uncommitted changes.", streaming: false, trace: { workspaceEditAccess: false, workspaceAutoApply: false, tools: [] } });
    expect(followup.getCommandFollowup("chat")?.phase).toBe("done");
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).toHaveBeenCalledTimes(1);
  });

  it.each(["pty", "cwd", "host", "workspace", "remote", "task", "task-status", "ai-disabled", "draft"])("blocks before sending when %s changed", async (change) => {
    track(); complete();
    if (change === "pty") fixtures.target.ptyId = 9;
    if (change === "cwd") fixtures.target.cwd = "/elsewhere";
    if (change === "host") { fixtures.target.isRemote = true; fixtures.target.host = "production"; }
    if (change === "workspace") changeSession({ workspacePath: "/elsewhere" });
    if (change === "remote") changeSession({ remoteWorkspace: { kind: "ssh", host: "production", path: "/app" } });
    if (change === "task") changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, id: "different-task" } });
    if (change === "task-status") changeSession({ task: { ...fixtures.sessions.get("chat")!.task!, status: "stopped" } });
    if (change === "ai-disabled") fixtures.prefs.aiEnabled = false;
    if (change === "draft") changeSession({ input: "Wait, inspect the other branch instead" });
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).not.toHaveBeenCalled();
    expect(messages()).toHaveLength(1);
    expect(followup.getCommandFollowup("chat")?.phase).toBe("paused");
    if (change === "draft") expect(fixtures.sessions.get("chat")!.input).toBe("Wait, inspect the other branch instead");
  });

  it("does not turn a non-Task observation into a newly started Task's follow-up", async () => {
    changeSession({ task: undefined });
    track(); complete();
    changeSession({ task: makeSession().task });
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).not.toHaveBeenCalled();
  });

  it("honors per-chat ownership while another normal request is active", async () => {
    track(); complete();
    const existing = lifecycle.beginAiRequest("chat")!;
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).not.toHaveBeenCalled();
    expect(lifecycle.isCurrentAiRequest(existing)).toBe(true);
    expect(followup.getCommandFollowup("chat")?.phase).toBe("paused");
    lifecycle.cancelAiRequest(existing);
  });

  it("keeps safe evidence local when selected chat history contains a secret", async () => {
    changeSession({ messages: [{ role: "user", content: "token=private-previous-message" }] });
    track(); complete();
    await followup.analyzeCommandFollowup("chat", "run-1");
    expect(client.streamChat).not.toHaveBeenCalled();
    expect(messages()).toHaveLength(2);
    expect(followup.getCommandFollowup("chat")?.note).toContain("history");
    const next = lifecycle.beginAiRequest("chat");
    expect(next).not.toBeNull();
    lifecycle.cancelAiRequest(next!);
  });

  it.each(["automatic", "manual"] as const)("feedback cancels a %s stream, suppresses late deltas and preserves correction ownership", async (trigger) => {
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1", "dock", trigger);
    const call = vi.mocked(client.streamChat).mock.calls[0];
    call[3]("Initial finding.");
    followup.pauseCommandFollowup("chat", "User correction takes priority.");
    expect(call[5]?.aborted).toBe(true);
    const correction = lifecycle.beginAiRequest("chat")!;
    expect(correction).not.toBeNull();
    changeSession({ messages: [...messages(), { id: correction.id, role: "assistant", content: "Corrected answer.", streaming: true }] });
    call[3](" THIS IS A STALE DELTA");
    resolve(); await analysis;
    expect(JSON.stringify(messages())).not.toContain("STALE DELTA");
    expect(lifecycle.isCurrentAiRequest(correction)).toBe(true);
    expect(messages()[messages().length - 1]).toMatchObject({ id: correction.id, content: "Corrected answer.", streaming: true });
    expect(followup.getCommandFollowup("chat")?.phase).toBe("paused");
    lifecycle.cancelAiRequest(correction);
  });

  it("cancels on a scope change detected during streaming without appending the changed-scope delta", async () => {
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1");
    const call = vi.mocked(client.streamChat).mock.calls[0];
    fixtures.target.cwd = "/other-project";
    call[3]("This delta should not be visible");
    expect(call[5]?.aborted).toBe(true);
    resolve(); await analysis;
    expect(JSON.stringify(messages())).not.toContain("This delta should not be visible");
    expect(followup.getCommandFollowup("chat")?.phase).toBe("paused");
  });

  it("keeps sessions separate when a different chat is stopped during analysis", async () => {
    fixtures.sessions.set("other", makeSession("other", "other-task"));
    track(); complete();
    let resolve!: () => void;
    vi.mocked(client.streamChat).mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
    const analysis = followup.analyzeCommandFollowup("chat", "run-1");
    followup.pauseCommandFollowup("other");
    const call = vi.mocked(client.streamChat).mock.calls[0];
    expect(call[5]?.aborted).toBe(false);
    call[3]("Correct chat finding");
    resolve(); await analysis;
    expect(messages("other")).toHaveLength(0);
    expect(messages()[messages().length - 1].content).toBe("Correct chat finding");
  });
});
