import { beforeEach, expect, it } from "vitest";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest, isWorkflowShellLanguage, requestWorkflowCapture, workflowCaptureError } from "./captureRequest";

beforeEach(() => clearWorkflowCaptureRequest());

it("captures exact source without splitting, stripping, or executing it", () => {
  const text = "$ printf first\nprintf second\noutput ";
  requestWorkflowCapture(text, "terminal-selection");
  expect(getWorkflowCaptureRequest()).toEqual({ id: expect.any(Number), text, source: "terminal-selection" });
});
it("a stale close cannot discard a newer capture", () => {
  requestWorkflowCapture("printf first", "terminal-selection"); const first = getWorkflowCaptureRequest()!;
  requestWorkflowCapture("printf second", "ai-code"); clearWorkflowCaptureRequest(first.id);
  expect(getWorkflowCaptureRequest()?.text).toBe("printf second");
  clearWorkflowCaptureRequest(getWorkflowCaptureRequest()!.id); expect(getWorkflowCaptureRequest()).toBeNull();
});
it("rejects invalid sources without truncating or removing characters", () => {
  expect(workflowCaptureError(" \n ")).toContain("Select a command");
  expect(workflowCaptureError("é".repeat(4001))).toContain("8,000 UTF-8 bytes");
  expect(workflowCaptureError("printf \x1b[31mhello")).toContain("control characters");
  expect(workflowCaptureError("printf a\n\tprintf b\r\n")).toBeNull();
});
it("recognizes only explicitly supported shell language fences", () => {
  for (const lang of ["sh", "bash", "zsh", "shell", "BASH", " sh "]) expect(isWorkflowShellLanguage(lang)).toBe(true);
  for (const lang of ["", "text", "json", "python", "shellscript", "console", "javascript", "fish", "bash extra"]) expect(isWorkflowShellLanguage(lang)).toBe(false);
});
