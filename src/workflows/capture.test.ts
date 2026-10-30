import { beforeEach, expect, it } from "vitest";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest, isWorkflowShellLanguage, requestWorkflowCapture, requestWorkflowStepsCapture, workflowCaptureError, workflowCaptureStepsError } from "./captureRequest";

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
it("captures a batch with exact authored boundaries and cloned proposal metadata", () => {
  const steps = ["  printf one  ", "printf '%s\\n' \\\n  two"];
  const stepTitles = ["First", "Second"];
  const selectedIndices = [1];
  requestWorkflowStepsCapture(steps, "ai-code", { name: "Check", description: "Review first", stepTitles, selectedIndices });
  expect(getWorkflowCaptureRequest()).toEqual({ id: expect.any(Number), text: steps.join("\n\n"), steps: [...steps], source: "ai-code", name: "Check", description: "Review first", stepTitles: [...stepTitles], selectedIndices: [1] });
  steps[0] = "changed"; stepTitles[0] = "changed"; selectedIndices.push(0);
  expect(getWorkflowCaptureRequest()?.steps).toEqual(["  printf one  ", "printf '%s\\n' \\\n  two"]);
  expect(getWorkflowCaptureRequest()?.stepTitles).toEqual(["First", "Second"]);
  expect(getWorkflowCaptureRequest()?.selectedIndices).toEqual([1]);
});
it("does not let an older batch review close a newer capture", () => {
  requestWorkflowStepsCapture(["pwd", "git status"], "ai-code");
  const first = getWorkflowCaptureRequest()!;
  requestWorkflowStepsCapture(["whoami", "hostname"], "ai-code");
  clearWorkflowCaptureRequest(first.id);
  expect(getWorkflowCaptureRequest()?.steps).toEqual(["whoami", "hostname"]);
});
it("validates batches without combining their byte budgets or splitting multiline shell text", () => {
  expect(workflowCaptureStepsError(["é".repeat(4000), "a".repeat(8000)])).toBeNull();
  expect(workflowCaptureStepsError(["printf 'one\ntwo'", "printf three"], ["First", ""])).toBeNull();
  expect(workflowCaptureStepsError([])).toContain("at least one");
  expect(workflowCaptureStepsError(Array(101).fill("pwd"))).toContain("at most 100");
  expect(workflowCaptureStepsError(["pwd", "\n "])).toContain("Step 2");
  expect(workflowCaptureStepsError(["pwd", "é".repeat(4001)])).toContain("8,000 UTF-8 bytes");
  expect(workflowCaptureStepsError(["pwd", "echo\u0085bad"])).toContain("control characters");
  expect(workflowCaptureStepsError(["pwd"], [])).toContain("match the number");
  expect(workflowCaptureStepsError(["pwd"], ["é".repeat(81)])).toContain("160 UTF-8 bytes");
  expect(workflowCaptureStepsError(["pwd"], ["\u001bTitle"])).toContain("control characters");
});
it("rejects hidden line separators in step titles without changing multiline commands", () => {
  for (const separator of ["\r", "\n", "\t", "\u2028", "\u2029"]) {
    expect(workflowCaptureStepsError(["printf 'one\ntwo'"], [`First${separator}second`])).toContain("single-line");
  }
  expect(workflowCaptureStepsError(["printf 'one\ntwo'"], ["Print two lines"])).toBeNull();
});
