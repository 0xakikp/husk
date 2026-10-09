import { expect, it } from "vitest";
import { tokenizeCommand } from "../lib/shellQuote";
import { linkedScriptWorkflow } from "./linkedScripts";
import { compileWorkflow, getWorkflowInputs } from "./params";

it.each([
  "/project/scripts/check.sh",
  "/project/my scripts/check environment.sh",
  "/project/it's a script.sh",
  "/project/$(echo unexpected); & `echo unexpected`.sh",
  "/project/{{count=5}}-{{check}}.sh",
  "/project/a'{{value}}'b.sh",
])("quotes the original script path as a single literal executable: %s", path => {
  const workflow = linkedScriptWorkflow({ id: "script_test", name: "Check", path, createdAt: 1 });
  expect(getWorkflowInputs(workflow)).toEqual([]);
  const compiled = compileWorkflow(workflow, {});
  expect(compiled.steps).toHaveLength(1);
  expect(tokenizeCommand(compiled.steps[0])).toEqual([path]);
  expect(workflow.stopOnError).toBe(true);
  expect(workflow).not.toHaveProperty("contents");
});
