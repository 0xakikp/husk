import { afterEach, expect, it } from "vitest";
import { getPromptPosition, setActiveTerminalPromptReader, setPromptPosition } from "./terminalContext";

afterEach(() => setPromptPosition(null));

it("reads the live per-terminal position instead of retaining stale resize coordinates", () => {
  let position: { row: number; col: number } | null = { row: 1, col: 2 };
  setActiveTerminalPromptReader(() => position);
  expect(getPromptPosition()).toEqual({ row: 1, col: 2 });
  position = { row: 3, col: 2 };
  expect(getPromptPosition()).toEqual({ row: 3, col: 2 });
  position = null;
  expect(getPromptPosition()).toBeNull();
});

it("replaces the reader when switching terminals and supports explicitly clearing it", () => {
  setActiveTerminalPromptReader(() => ({ row: 10, col: 4 }));
  setActiveTerminalPromptReader(() => ({ row: 20, col: 2 }));
  expect(getPromptPosition()).toEqual({ row: 20, col: 2 });
  setPromptPosition(null);
  expect(getPromptPosition()).toBeNull();
});
