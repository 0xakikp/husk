import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissTerminalWelcome, disposeTerminalWelcome, getTerminalWelcome, initializeTerminalWelcome,
  noteTerminalWelcomeCommand, observeTerminalWelcomeCwd, observeTerminalWelcomePrompt, scrollTerminalWelcome, subscribeTerminalWelcome,
} from "./terminalWelcomeState";

afterEach(() => { disposeTerminalWelcome(1); disposeTerminalWelcome(2); });

describe("passive terminal welcome state", () => {
  it("advances monotonically with output rows until explicitly retired", () => {
    initializeTerminalWelcome(1);
    observeTerminalWelcomePrompt(1, "/project", true);
    scrollTerminalWelcome(1, 2);
    const secondRow = getTerminalWelcome(1);
    expect(secondRow).toMatchObject({ visible: true, scrollRows: 2 });
    scrollTerminalWelcome(1, 1);
    scrollTerminalWelcome(1, NaN);
    expect(getTerminalWelcome(1)).toBe(secondRow);
    observeTerminalWelcomePrompt(1, "/project", true);
    expect(getTerminalWelcome(1)?.scrollRows).toBe(2);
    scrollTerminalWelcome(1, 5);
    expect(getTerminalWelcome(1)?.scrollRows).toBe(5);
    dismissTerminalWelcome(1);
    scrollTerminalWelcome(1, 8);
    expect(getTerminalWelcome(1)).toMatchObject({ visible: false, scrollRows: 5 });
  });
  it("requires observed cwd and a verified local prompt before becoming visible", () => {
    expect(getTerminalWelcome(1)).toBeNull();
    initializeTerminalWelcome(1);
    expect(getTerminalWelcome(1)).toEqual({ cwd: "", visible: false, atPrompt: false });
    observeTerminalWelcomePrompt(1, "", false);
    observeTerminalWelcomeCwd(1, "/remote", false);
    expect(getTerminalWelcome(1)).toEqual({ cwd: "", visible: false, atPrompt: false });
    observeTerminalWelcomeCwd(1, "/project", true);
    expect(getTerminalWelcome(1)).toEqual({ cwd: "/project", visible: false, atPrompt: false });
    observeTerminalWelcomePrompt(1, "/project", true);
    expect(getTerminalWelcome(1)).toEqual({ cwd: "/project", visible: true, atPrompt: true });
  });

  it("provides immutable stable snapshots with per-terminal subscriptions", () => {
    const changed = vi.fn();
    const otherChanged = vi.fn();
    const unsubscribe = subscribeTerminalWelcome(1, changed);
    const unsubscribeOther = subscribeTerminalWelcome(2, otherChanged);
    initializeTerminalWelcome(1);
    observeTerminalWelcomePrompt(1, "/project", true);
    const snapshot = getTerminalWelcome(1)!;
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(otherChanged).not.toHaveBeenCalled();
    observeTerminalWelcomePrompt(1, "/project", true);
    expect(getTerminalWelcome(1)).toBe(snapshot);
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe(); unsubscribeOther();
    dismissTerminalWelcome(1);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("never resurrects a dismissed welcome on reinitialization or later prompts", () => {
    initializeTerminalWelcome(1);
    dismissTerminalWelcome(1);
    initializeTerminalWelcome(1);
    observeTerminalWelcomeCwd(1, "/other", true);
    observeTerminalWelcomePrompt(1, "/other", true);
    expect(getTerminalWelcome(1)).toEqual({ cwd: "", visible: false, atPrompt: false });
  });

  it("retires a visible welcome when verified local provenance is lost", () => {
    initializeTerminalWelcome(1);
    observeTerminalWelcomePrompt(1, "/project", true);
    observeTerminalWelcomeCwd(1, "/project", false);
    observeTerminalWelcomePrompt(1, "/project", true);
    expect(getTerminalWelcome(1)?.visible).toBe(false);
  });

  it("clears disposed sessions and allows a genuinely new session at the same leaf", () => {
    initializeTerminalWelcome(1);
    dismissTerminalWelcome(1);
    disposeTerminalWelcome(1);
    expect(getTerminalWelcome(1)).toBeNull();
    initializeTerminalWelcome(1);
    observeTerminalWelcomePrompt(1, "/project", true);
    expect(getTerminalWelcome(1)).toEqual({ cwd: "/project", visible: true, atPrompt: true });
  });

  it("keeps the greeting during commands while accurately tracking prompt readiness", () => {
    initializeTerminalWelcome(1);
    observeTerminalWelcomePrompt(1, "/project", true);
    noteTerminalWelcomeCommand(1);
    expect(getTerminalWelcome(1)).toEqual({ cwd: "/project", visible: true, atPrompt: false });
    observeTerminalWelcomePrompt(1, "/project", true);
    expect(getTerminalWelcome(1)?.atPrompt).toBe(true);
    dismissTerminalWelcome(1);
    noteTerminalWelcomeCommand(1);
    expect(getTerminalWelcome(1)?.visible).toBe(false);
  });
});
