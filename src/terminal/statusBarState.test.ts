import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTerminalStatusActivity, completeTerminalStatusCommand, disposeTerminalStatus, getTerminalStatus,
  initializeTerminalStatus, observeTerminalStatusPrompt, observeTerminalStatusScope,
  startTerminalStatusCommand, subscribeTerminalStatus,
  MAX_RECENT_STATUS_TOOLS,
} from "./statusBarState";

const local = (cwd?: string) => ({ observedHost: null, isRemote: false, remoteTarget: null, cwd });
afterEach(() => { disposeTerminalStatus(1); disposeTerminalStatus(2); });

describe("per-terminal status observations", () => {
  it("keeps only observed tool names in bounded, terminal-local recent activity", () => {
    initializeTerminalStatus(1, "one"); initializeTerminalStatus(2, "two");
    observeTerminalStatusScope(1, local("/one"));
    startTerminalStatusCommand(1, "oci --profile private-account compute instance list", 10);
    completeTerminalStatusCommand(1, 0, 20);
    startTerminalStatusCommand(1, "pnpm test", 30);
    completeTerminalStatusCommand(1, 0, 40);
    const recent = getTerminalStatus(1)!.recentTools!;
    expect(recent).toEqual([{ id: "cli:pnpm", seenAt: 30 }, { id: "oci", seenAt: 10 }]);
    expect(Object.isFrozen(recent)).toBe(true);
    expect(Object.isFrozen(recent[0])).toBe(true);
    expect(JSON.stringify(recent)).not.toContain("private-account");
    expect(getTerminalStatus(2)?.recentTools).toEqual([]);
    startTerminalStatusCommand(1, "pwd", 50);
    expect(getTerminalStatus(1)?.recentTools).toBe(recent);
    startTerminalStatusCommand(1, "oci --profile other compute instance list", 60);
    expect(getTerminalStatus(1)?.recentTools).toEqual([{ id: "oci", seenAt: 60 }, { id: "cli:pnpm", seenAt: 30 }]);
    for (let index = 0; index < 20; index++) startTerminalStatusCommand(1, `teamtool${index} list`, 70 + index);
    expect(getTerminalStatus(1)?.recentTools).toHaveLength(MAX_RECENT_STATUS_TOOLS);
    expect(getTerminalStatus(1)?.recentTools?.[0]).toEqual({ id: "cli:teamtool19", seenAt: 89 });
  });

  it("excludes sensitive or overlong commands from recent tool metadata", () => {
    initializeTerminalStatus(1, "one");
    const initial = getTerminalStatus(1)?.recentTools;
    for (const command of [
      "az login --password dont-display-this", "SECRET_TOKEN=private gcloud compute instances list",
      "teamtool --token private", `oci compute instance list ${"x".repeat(481)}`,
    ]) {
      startTerminalStatusCommand(1, command, 1);
      expect(getTerminalStatus(1)?.recentTools).toBe(initial);
    }
  });

  it("clears recent tools across SSH boundaries, same-host reconnects, and new shells", () => {
    initializeTerminalStatus(1, "one"); observeTerminalStatusScope(1, local("/one"));
    startTerminalStatusCommand(1, "docker ps", 1);
    observeTerminalStatusScope(1, { observedHost: "server", isRemote: true, remoteTarget: "server", boundary: true });
    expect(getTerminalStatus(1)?.recentTools).toEqual([]);
    startTerminalStatusCommand(1, "oci compute instance list", 2);
    expect(getTerminalStatus(1)?.recentTools).toHaveLength(1);
    observeTerminalStatusScope(1, { observedHost: "server", isRemote: true, remoteTarget: "server", boundary: true });
    expect(getTerminalStatus(1)?.recentTools).toEqual([]);
    startTerminalStatusCommand(1, "podman ps", 3);
    observeTerminalStatusScope(1, { ...local("/one"), boundary: true });
    expect(getTerminalStatus(1)?.recentTools).toEqual([]);
    startTerminalStatusCommand(1, "pnpm test", 4);
    initializeTerminalStatus(1, "two");
    expect(getTerminalStatus(1)?.recentTools).toEqual([]);
  });

  it("starts unknown, is stable on no-op updates, and only notifies that leaf", () => {
    const one = vi.fn(); const two = vi.fn(); const none = vi.fn();
    const unsubscribe = [subscribeTerminalStatus(1, one), subscribeTerminalStatus(2, two), subscribeTerminalStatus(null, none)];
    expect(getTerminalStatus(null)).toBeNull();
    expect(getTerminalStatus(1)).toBeNull();
    initializeTerminalStatus(1, "session-1");
    const initial = getTerminalStatus(1);
    expect(initial).toMatchObject({ scope: "unknown", cwd: null, host: null, command: "", lastRun: null, atPrompt: false });
    initializeTerminalStatus(1, "session-1");
    observeTerminalStatusPrompt(1, false);
    observeTerminalStatusScope(1, { observedHost: undefined, isRemote: false, remoteTarget: null, cwd: "/unverified" });
    expect(getTerminalStatus(1)).toBe(initial);
    expect(one).toHaveBeenCalledOnce();
    expect(two).not.toHaveBeenCalled();
    expect(none).not.toHaveBeenCalled();
    unsubscribe.forEach(fn => fn());
  });

  it("keeps independent command duration and outcomes through prompt and cwd updates", () => {
    initializeTerminalStatus(1, "session-1"); initializeTerminalStatus(2, "session-2");
    observeTerminalStatusScope(1, local("/one")); observeTerminalStatusScope(2, local("/two"));
    const other = getTerminalStatus(2);
    startTerminalStatusCommand(1, "npm test", 1_000);
    completeTerminalStatusCommand(1, 1, 3_400);
    observeTerminalStatusPrompt(1, true);
    const completed = getTerminalStatus(1)!;
    expect(completed.lastRun).toEqual({ command: "npm test", exitCode: 1, durationMs: 2_400, at: 3_400 });
    expect(completed).toMatchObject({ atPrompt: true, command: "", startedAt: null });
    observeTerminalStatusScope(1, local("/one/child"));
    expect(getTerminalStatus(1)).toMatchObject({ scopeKey: completed.scopeKey, cwd: "/one/child", lastRun: completed.lastRun });
    completeTerminalStatusCommand(1, 0, 3_500); // Extra prompt metadata is not a new result.
    expect(getTerminalStatus(1)?.lastRun).toBe(completed.lastRun);
    expect(getTerminalStatus(2)).toBe(other);
  });

  it("drops local context on SSH entry and retains remote provenance after an incomplete flag reset", () => {
    initializeTerminalStatus(1, "session-1");
    observeTerminalStatusScope(1, local("/local"));
    startTerminalStatusCommand(1, "kubectl get pods", 10);
    completeTerminalStatusCommand(1, 0, 20);
    const localKey = getTerminalStatus(1)!.scopeKey;
    observeTerminalStatusScope(1, { observedHost: undefined, isRemote: true, remoteTarget: "deploy@prod", boundary: true });
    expect(getTerminalStatus(1)).toMatchObject({ scope: "remote", host: "deploy@prod", cwd: null, lastRun: null });
    expect(getTerminalStatus(1)?.scopeKey).not.toBe(localKey);
    observeTerminalStatusScope(1, { observedHost: undefined, isRemote: true, remoteTarget: "deploy@prod", cwd: "/remote" });
    startTerminalStatusCommand(1, "docker ps", 30);
    completeTerminalStatusCommand(1, 0, 40);
    const remote = getTerminalStatus(1);
    observeTerminalStatusScope(1, { observedHost: undefined, isRemote: false, remoteTarget: null });
    expect(getTerminalStatus(1)).toBe(remote);
    observeTerminalStatusScope(1, { ...local(), boundary: true });
    expect(getTerminalStatus(1)).toMatchObject({ scope: "local", cwd: null, host: null, lastRun: null });
    observeTerminalStatusScope(1, local("/fresh-local"));
    expect(getTerminalStatus(1)?.cwd).toBe("/fresh-local");
  });

  it("keeps confirmed remote commands after D and clears same-host reconnects", () => {
    initializeTerminalStatus(1, "session-1");
    observeTerminalStatusScope(1, { observedHost: "server", isRemote: true, remoteTarget: "server", cwd: "/remote" });
    startTerminalStatusCommand(1, "ls", 100);
    completeTerminalStatusCommand(1, null, 200);
    const finished = getTerminalStatus(1);
    observeTerminalStatusScope(1, { observedHost: "server", isRemote: false, remoteTarget: null });
    expect(getTerminalStatus(1)).toBe(finished);
    observeTerminalStatusScope(1, { observedHost: "server", isRemote: true, remoteTarget: "server", boundary: true });
    expect(getTerminalStatus(1)).toMatchObject({ scope: "remote", cwd: null, lastRun: null });
    expect(getTerminalStatus(1)?.scopeKey).not.toBe(finished?.scopeKey);
  });

  it("restarts cleanly and never fabricates a disconnected command result", () => {
    initializeTerminalStatus(1, "session-1");
    observeTerminalStatusScope(1, local("/one"));
    startTerminalStatusCommand(1, "long-running", 100);
    clearTerminalStatusActivity(1);
    expect(getTerminalStatus(1)).toMatchObject({ command: "", startedAt: null, lastRun: null });
    initializeTerminalStatus(1, "session-2");
    expect(getTerminalStatus(1)).toMatchObject({ scopeKey: "session-2:0", scope: "unknown", cwd: null, lastRun: null });
    disposeTerminalStatus(1);
    expect(getTerminalStatus(1)).toBeNull();
  });

  it("treats repeated identical commands as fresh occurrences and refuses negative elapsed time", () => {
    initializeTerminalStatus(1, "session-1");
    startTerminalStatusCommand(1, "aws s3 ls", 100);
    completeTerminalStatusCommand(1, 0, 200);
    const first = getTerminalStatus(1)?.lastRun;
    startTerminalStatusCommand(1, "aws s3 ls", 300);
    expect(getTerminalStatus(1)?.startedAt).toBe(300);
    completeTerminalStatusCommand(1, 0, 400);
    expect(getTerminalStatus(1)?.lastRun).not.toBe(first);
    expect(getTerminalStatus(1)?.lastRun?.at).toBe(400);
    startTerminalStatusCommand(1, "pwd", 500);
    completeTerminalStatusCommand(1, 0, 499);
    expect(getTerminalStatus(1)?.lastRun?.durationMs).toBeNull();
  });
});
