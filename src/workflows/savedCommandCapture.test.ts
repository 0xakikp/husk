import { beforeEach, expect, it, vi } from "vitest";
vi.mock("./editorActions", () => ({ openSavedCommandEditor: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { openSavedCommandEditor } from "./editorActions";
import { toast } from "../toast";
import { captureSavedCommand } from "./savedCommandCapture";
beforeEach(() => vi.mocked(openSavedCommandEditor).mockReset().mockReturnValue(true));

it.each(["terminal-selection", "terminal-history", "ai-code"] as const)("opens only an exact-text draft from %s", source => {
  const text = "  arsloginp dev host-1  ";
  expect(captureSavedCommand(text, source)).toBe(true);
  expect(openSavedCommandEditor).toHaveBeenCalledExactlyOnceWith(text, source);
  expect(toast).not.toHaveBeenCalled();
});
it("preserves multi-line captures for explicit repair in the editor", () => {
  expect(captureSavedCommand("printf hello\nprintf goodbye\n", "ai-code")).toBe(true);
  expect(openSavedCommandEditor).toHaveBeenCalledWith("printf hello\nprintf goodbye\n", "ai-code");
});
it.each(["", "\x1b[2J", "x".repeat(8001)])("rejects empty, control-bearing or oversized captures", text => {
  expect(captureSavedCommand(text, "terminal-selection")).toBe(false);
  expect(openSavedCommandEditor).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
});
it("respects cancelled replacement and reports busy/storage-independent errors", () => {
  vi.mocked(openSavedCommandEditor).mockReturnValueOnce(false);
  expect(captureSavedCommand("pwd", "terminal-history")).toBe(false);
  expect(toast).not.toHaveBeenCalled();
  vi.mocked(openSavedCommandEditor).mockImplementationOnce(() => { throw new Error("Draft is being saved"); });
  expect(captureSavedCommand("pwd", "terminal-history")).toBe(false);
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Draft is being saved" }));
});
