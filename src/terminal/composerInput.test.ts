import { expect, it } from "vitest";
import { composerKeyAction, previousUserQuestion } from "./composerInput";

it.each([{ isComposing: true }, { keyCode: 229 }])("does not send or choose during IME confirmation %j", (extra) => {
  const event = { key: "Enter", shiftKey: false, ...extra };
  expect(composerKeyAction(event, false, 0, true)).toBeNull();
  expect(composerKeyAction(event, true, 3, true)).toBeNull();
});
it("sends path-led prompts when there is no matching slash command", () => {
  expect(composerKeyAction({ key: "Enter", shiftKey: false }, true, 0, true)).toBe("send");
  expect(composerKeyAction({ key: "ArrowDown", shiftKey: false }, true, 0, true)).toBeNull();
});
it("keeps Shift+Enter as a newline even with slash suggestions open", () => {
  expect(composerKeyAction({ key: "Enter", shiftKey: true }, true, 2, true)).toBeNull();
});
it("selects real suggestions and dismisses the palette before closing chat", () => {
  expect(composerKeyAction({ key: "Enter", shiftKey: false }, true, 2, true)).toBe("choose");
  expect(composerKeyAction({ key: "Escape", shiftKey: false }, true, 0, true)).toBe("dismiss");
  expect(composerKeyAction({ key: "Escape", shiftKey: false }, false, 0, true)).toBe("close");
});
it("reuses a real user question, never command or integration evidence", () => {
  expect(previousUserQuestion([
    { role: "user", content: "Check the project" },
    { role: "assistant", content: "Checking" },
    { role: "user", kind: "command-result", content: "command output" },
    { role: "user", kind: "integration-result", content: "external output" },
    { role: "assistant", content: "Done" },
  ], 4)).toBe("Check the project");
});
