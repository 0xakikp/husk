import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { compileWorkflow, extractParams, getWorkflowInputs } from "./params";
import type { Workflow } from "./store";
const wf: Workflow = { id: "wf_test", name: "Print", steps: ["printf '%s' {{value}}"] };
const run = (command: string) => execFileSync("sh", ["-c", command], { encoding: "utf8", timeout: 2000 });
it("keeps legacy placeholders/defaults and merges typed input metadata", () => {
  expect(extractParams(["echo {{count=5}} {{name}}", "echo {{count}}"]).map((item) => item.name)).toEqual(["count", "name"]);
  expect(getWorkflowInputs({ steps: ["git log -n {{count=5}}"], inputs: [{ name: "count", label: "Number of commits", type: "number", required: true }] })[0]).toMatchObject({ label: "Number of commits", defaultValue: "5" });
  expect(compileWorkflow({ steps: ["printf '%s' {{count=5}}"] }, {}).steps[0]).toContain("'5'");
});
it.each(["{{value}}", '"{{value}}"', "'{{value}}'", "prefix-{{value}}-suffix"])("inserts literal values in %s without shell injection", (template) => {
  const value = "odd'name; $(printf INJECTED) & `printf bad` *";
  const command = compileWorkflow({ ...wf, steps: ["printf '%s' " + template] }, { value }).command;
  expect(run(command)).toBe(template.startsWith("prefix") ? "prefix-" + value + "-suffix" : value);
  expect(command).not.toContain("\n");
});
it("preserves an authored home prefix while quoting its runtime suffix", () => {
  const result = compileWorkflow({ steps: ["printf '%s' ~/{{folder}}"] }, { folder: "a b;literal" });
  expect(result.steps[0]).toBe("printf '%s' ~/'a b;literal'");
});
it("requires missing inputs, ignores inherited keys, and validates number values", () => {
  expect(() => compileWorkflow(wf, {})).toThrow("required");
  expect(() => compileWorkflow(wf, Object.create({ value: "inherited" }))).toThrow("required");
  const number: Workflow = { ...wf, inputs: [{ name: "value", label: "Count", type: "number", required: true }] };
  for (const value of ["", "NaN", "Infinity", "2; echo bad", " 2"]) expect(() => compileWorkflow(number, { value })).toThrow();
  expect(run(compileWorkflow(number, { value: "2.5" }).command)).toBe("2.5");
});
it.each(["{{value}} arg", "eval {{value}}", "sh -c {{value}}", "if {{value}}; then true; fi", "command {{value}}", "printf '%s' $(echo {{value}})", "echo {{value}} > out", "echo $HOME/{{value}}"])("rejects ambiguous parameter placement: %s", (step) => {
  expect(() => compileWorkflow({ steps: [step] }, { value: "anything" })).toThrow();
});
it("rejects controls, multiline commands, oversized inputs, and malformed placeholders", () => {
  for (const value of ["a\nb", "a\rb", "a\tb", "é".repeat(1001)]) expect(() => compileWorkflow(wf, { value })).toThrow();
  expect(() => compileWorkflow({ steps: ["echo first\necho second"] }, {})).toThrow("one command line");
  expect(() => compileWorkflow({ steps: ["echo {{broken"] }, {})).toThrow("Malformed");
});
it("does not let semicolons in a later step bypass stop-on-error", () => {
  const command = compileWorkflow({ steps: ["false", "printf first; printf leaked"], stopOnError: true }, {}).command;
  const result = spawnSync("sh", ["-c", command], { encoding: "utf8", timeout: 2000 });
  expect(result.stdout).toBe(""); expect(result.status).toBe(1);
  expect(run(compileWorkflow({ steps: ["false", "printf continued"], stopOnError: false }, {}).command)).toBe("continued");
});
it("shares directory and environment across steps without affecting the parent shell", () => {
  expect(run(compileWorkflow({ steps: ["cd /", "WF_TEST_VALUE=kept", "printf '%s:%s' \"$PWD\" \"$WF_TEST_VALUE\""] }, {}).command)).toBe("/:kept");
});
it("rejects inline defaults for explicitly secret inputs", () => {
  expect(() => getWorkflowInputs({ steps: ["echo {{token=unsafe}}"], inputs: [{ name: "token", label: "Token", type: "secret", required: true }] })).toThrow("inline defaults");
});
