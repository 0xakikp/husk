import { describe, expect, it } from "vitest";
import type { AiSession } from "./sessionStore";
import type { Pane } from "../terminalPanes";
import { resolveTerminalReturn } from "./terminalReturn";

function session(overrides: Partial<AiSession> = {}): AiSession {
  return {
    id: "global",
    name: "Chat",
    messages: [],
    input: "",
    source: "ai-tab",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function leaf(id: number, initialCwd?: string): Pane {
  return { kind: "leaf", id, initialCwd };
}

function tab(id: number, root: Pane, focused = root.kind === "leaf" ? root.id : 0) {
  return { id, root, focused };
}

describe("resolveTerminalReturn", () => {
  it("returns to the original live terminal before considering its current folder", () => {
    const target = resolveTerminalReturn(
      session({ id: "tab-2", tabId: 2, workspacePath: "/repo" }),
      [tab(1, leaf(11, "/repo")), tab(2, leaf(22, "/tmp"))],
      1,
    );
    expect(target).toEqual({ kind: "tab", tabId: 2, leafId: 22, reason: "source" });
  });

  it("supports older tab sessions whose tab id only exists in the session id", () => {
    const target = resolveTerminalReturn(session({ id: "tab-7" }), [tab(7, leaf(70, "/tmp"))], 7);
    expect(target).toEqual({ kind: "tab", tabId: 7, leafId: 70, reason: "source" });
  });

  it("prefers an active terminal already inside the selected workspace", () => {
    const target = resolveTerminalReturn(
      session({ id: "tab-9", tabId: 9, workspacePath: "/repo" }),
      [tab(1, leaf(11, "/repo/packages/app")), tab(2, leaf(22, "/repo"))],
      2,
    );
    expect(target).toEqual({ kind: "tab", tabId: 2, leafId: 22, reason: "workspace" });
  });

  it("finds the matching pane inside a split terminal tab", () => {
    const split: Pane = {
      kind: "split",
      id: 100,
      dir: "row",
      ratio: 0.5,
      a: leaf(11, "/elsewhere"),
      b: leaf(12, "/repo/apps/web"),
    };
    const target = resolveTerminalReturn(
      session({ workspacePath: "/repo" }),
      [tab(1, split, 11)],
      1,
    );
    expect(target).toEqual({ kind: "tab", tabId: 1, leafId: 12, reason: "workspace" });
  });

  it("opens a fresh local shell in the workspace when no matching terminal remains", () => {
    const target = resolveTerminalReturn(
      session({ id: "tab-9", tabId: 9, workspacePath: "/repo" }),
      [tab(1, leaf(11, "/elsewhere"))],
      1,
    );
    expect(target).toEqual({ kind: "new-local", cwd: "/repo" });
  });

  it("requires an explicit reconnect when a remote chat's source terminal is gone", () => {
    const target = resolveTerminalReturn(
      session({
        id: "tab-9",
        tabId: 9,
        remoteWorkspace: { kind: "ssh", host: "prod", path: "/srv/app" },
      }),
      [tab(1, leaf(11, "/tmp"))],
      1,
    );
    expect(target).toEqual({ kind: "reconnect-remote", host: "prod", path: "/srv/app" });
  });

  it("uses the current terminal for a general chat without a workspace", () => {
    const target = resolveTerminalReturn(
      session(),
      [tab(1, leaf(11, "/one")), tab(2, leaf(22, "/two"))],
      2,
    );
    expect(target).toEqual({ kind: "tab", tabId: 2, leafId: 22, reason: "active" });
  });
});
