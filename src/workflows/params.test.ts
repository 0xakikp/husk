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
it("keeps saved command alias and function calls in the active shell without a child wrapper", () => {
  const command = compileWorkflow({ kind: "command", steps: ["  saved_alias  "] }, {});
  expect(command).toEqual({ steps: ["  saved_alias  "], command: "  saved_alias  " });
  expect(run("alias saved_alias='printf alias-ready'\n" + command.command)).toBe("alias-ready");
  expect(run("saved_function() { printf function-ready; }\n" + compileWorkflow({ kind: "command", steps: ["saved_function"] }, {}).command)).toBe("function-ready");
  expect(compileWorkflow({ steps: ["saved_alias"] }, {}).command).toMatch(/^sh -c /);
});
it.each(["{{value}}", "'{{value}}'", '"{{value}}"'])("uses portable literal whole arguments in saved commands: %s", (placeholder) => {
  const value = "Feature Branch/path_1.2:@+=,-";
  const compiled = compileWorkflow({ kind: "command", steps: ["saved_alias " + placeholder] }, { value });
  expect(compiled.command).toBe("saved_alias '" + value + "'");
  expect(run("alias saved_alias='printf %s'\n" + compiled.command)).toBe(value);
});
it("expands command defaults and optional empty arguments without starting a subshell", () => {
  expect(compileWorkflow({ kind: "command", steps: ["gco {{branch=main}}"] }, {}).command).toBe("gco 'main'");
  expect(compileWorkflow({ kind: "command", steps: ["echo {{value=}}"] }, {}).command).toBe("echo ''");
  expect(compileWorkflow({ kind: "command", steps: ["gs"], stopOnError: false }, {}).command).toBe("gs");
});
it.each(["O'Brien", "a\\b", "`whoami`", "$(whoami)", "a; echo bad", "a & whoami", "a|whoami", "%PATH%", "a\"b", "left‘right", "left’right", "left“right”,", "é", "a\nb", "a\tb"])("rejects command inputs needing unknown-shell escaping: %s", (value) => {
  expect(() => compileWorkflow({ kind: "command", steps: ["saved_alias {{value}}"] }, { value })).toThrow();
});
it.each(["saved_alias prefix-{{value}}", "saved_alias --flag={{value}}", "saved_alias ~/{{value}}", "saved_alias $HOME {{value}}", "saved_alias {{value}}; echo next", "saved_alias {{value}} | cat", "saved_alias {{value}} > out", "saved_alias @args {{value}}", "saved_alias --% {{value}}", "{{value}}", "eval {{value}}", "sh -c {{value}}", "pwsh -Command {{value}}", "powershell.exe -Command {{value}}", "sh.exe -c {{value}}", "iex {{value}}"])("rejects ambiguous command input grammar: %s", (step) => {
  expect(() => compileWorkflow({ kind: "command", steps: [step] }, { value: "literal" })).toThrow();
});
it("validates single-line command shape independently of import and permits authored non-parameter syntax unchanged", () => {
  for (const steps of [[], ["first", "second"], ["first\nsecond"], ["echo \x85bad"], ["echo {{broken"]]) expect(() => compileWorkflow({ kind: "command", steps }, {})).toThrow();
  const authored = "my_alias && cd ../project; echo $PWD";
  expect(compileWorkflow({ kind: "command", steps: [authored] }, {}).command).toBe(authored);
  expect(() => compileWorkflow({ kind: "command", steps: ["echo " + "{{value}} ".repeat(40)] }, { value: "x".repeat(2000) })).toThrow("64 KiB");
});
