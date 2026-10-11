import { expect, it } from "vitest";
import { assertShareableWorkflows, exportWorkflowJson, getWorkflowImportConflicts, mergeWorkflowImport, parseWorkflowImport } from "./transfer";
import { validateWorkflow, validateWorkflowList } from "./schema";
import type { Workflow } from "./store";
const wf: Workflow = { id: "wf_1", name: "History", steps: ["git log -n {{count}} --oneline"], stepTitles: ["Recent commits"], stopOnError: true, inputs: [{ name: "count", label: "Number of commits", type: "number", defaultValue: "5", required: true }] };
it("round-trips a versioned definition with titles/inputs but no runtime state", () => {
  const raw = { ...wf, values: { password: "runtime-secret" }, target: { cwd: "/private" } };
  const exported = exportWorkflowJson([raw]);
  expect(JSON.parse(exported)).toMatchObject({ format: "husk-workflows", version: 1 });
  expect(exported).not.toContain("runtime-secret"); expect(exported).not.toContain("/private");
  expect(parseWorkflowImport(exported)).toEqual([wf]);
});
it("accepts old Copy JSON single definitions/arrays and rejects unknown versions", () => {
  expect(parseWorkflowImport(JSON.stringify(wf))).toEqual([wf]);
  expect(parseWorkflowImport(JSON.stringify([wf]))).toEqual([wf]);
  expect(() => parseWorkflowImport('{"format":"husk-workflows","version":3,"workflows":[]}')).toThrow("Unsupported");
  expect(() => parseWorkflowImport("{")).toThrow("valid JSON");
  expect(() => parseWorkflowImport("[]")).toThrow("at least one");
});
it("round-trips saved alias commands through v2 and preserves kind during canonicalization", () => {
  const command: Workflow = { id: "wf_alias", name: "Quick status", kind: "command", steps: ["  gs  "], stopOnError: true };
  const exported = exportWorkflowJson([wf, command]);
  expect(JSON.parse(exported).version).toBe(2);
  expect(parseWorkflowImport(exported)).toEqual([wf, command]);
  expect(parseWorkflowImport(JSON.stringify({ ...command, runtimeValue: "discard-me" }))).toEqual([command]);
  expect(validateWorkflow({ ...command, values: { secret: "runtime-only" } })).toEqual(command);
  expect(JSON.parse(exportWorkflowJson([wf])).version).toBe(1);
  expect(parseWorkflowImport(JSON.stringify({ format: "husk-workflows", version: 2, workflows: [wf] }))).toEqual([wf]);
  expect(() => parseWorkflowImport(JSON.stringify({ format: "husk-workflows", version: 1, workflows: [command] }))).toThrow("version 2");
});
it("rejects unknown kinds and invalid saved command shapes instead of changing their meaning", () => {
  const command = { id: "wf_alias", name: "Alias", kind: "command", steps: ["gs"] };
  expect(() => validateWorkflow({ ...command, kind: "workflow" })).toThrow("kind");
  expect(() => validateWorkflow({ ...command, kind: null })).toThrow("kind");
  for (const steps of [["gs", "pwd"], ["gs\npwd"], ["gs\rpwd"], ["gs\tpwd"], ["gs\u2028pwd"], ["gs\x85pwd"], ["gs\x1bpwd"], ["é".repeat(4001)]]) expect(() => validateWorkflow({ ...command, steps })).toThrow();
  expect(() => parseWorkflowImport(JSON.stringify({ ...command, kind: "unknown" }))).toThrow("kind");
});
it("applies existing credential checks and conflict replacement to saved commands", () => {
  const command: Workflow = { id: wf.id, name: wf.name, kind: "command", steps: ["gco {{branch=main}}"] };
  const existing = validateWorkflowList([wf]);
  const merged = mergeWorkflowImport(existing, [command], { 0: { action: "replace", target: existing[0] } });
  expect(merged[0]).toMatchObject({ id: wf.id, kind: "command", steps: command.steps });
  expect(() => exportWorkflowJson([{ ...command, steps: ["tool --password abc"] }])).toThrow("credentials");
});
it("rejects oversized and malformed definitions without truncating commands", () => {
  expect(() => validateWorkflow({ ...wf, steps: ["é".repeat(4001)] })).toThrow("8,000".replace(",", ""));
  expect(() => validateWorkflow({ ...wf, steps: [""] })).toThrow();
  expect(() => validateWorkflow({ ...wf, stepTitles: [] })).toThrow("titles");
  expect(() => validateWorkflow({ ...wf, inputs: [wf.inputs![0], wf.inputs![0]] })).toThrow("Duplicate");
  expect(() => validateWorkflowList([wf, wf])).toThrow("unique");
});
it("keeps runtime-secret placeholders but blocks saved credentials/defaults", () => {
  const secret: Workflow = { ...wf, steps: ["tool --password {{password}}"], inputs: [{ name: "password", label: "Password", type: "secret", required: true }] };
  expect(() => exportWorkflowJson([secret])).not.toThrow();
  expect(() => exportWorkflowJson([{ ...secret, steps: ["tool --password a-real-secret"] }])).toThrow("credentials");
  expect(() => exportWorkflowJson([{ ...secret, steps: ["tool --password abc"] }])).toThrow("credentials");
  expect(() => exportWorkflowJson([{ ...secret, steps: ["tool --password '{{password}}'"] }])).not.toThrow();
  expect(() => validateWorkflow({ ...secret, inputs: [{ ...secret.inputs![0], defaultValue: "unsafe" }] })).toThrow("saved defaults");
  expect(() => assertShareableWorkflows([{ ...wf, steps: ["tool --token {{token=short}}"] }])).toThrow("credentials");
});
it("previews ID/name conflicts and supports Keep both, Replace, and Skip", () => {
  const existing = validateWorkflowList([wf]); const incoming = [{ ...wf, steps: ["git status"] }];
  expect(getWorkflowImportConflicts(existing, incoming)[0].matches).toEqual(existing);
  expect(() => mergeWorkflowImport(existing, incoming, {})).toThrow("Choose");
  const kept = mergeWorkflowImport(existing, incoming, { 0: { action: "keep-both" } });
  expect(kept).toHaveLength(2); expect(kept[1].name).toBe("History (2)"); expect(kept[1].id).not.toBe(wf.id);
  expect(mergeWorkflowImport(existing, incoming, { 0: { action: "skip" } })).toEqual(existing);
  expect(mergeWorkflowImport(existing, incoming, { 0: { action: "replace", target: existing[0] } })[0].steps).toEqual(["git status"]);
});
it("binds replacement to the reviewed saved contents and rejects double replacement", () => {
  const existing = validateWorkflowList([wf]);
  expect(() => mergeWorkflowImport([{ ...existing[0], description: "changed" }], [wf], { 0: { action: "replace", target: existing[0] } })).toThrow("changed");
  expect(() => mergeWorkflowImport(existing, [wf, { ...wf, id: "wf_2" }], { 0: { action: "replace", target: existing[0] }, 1: { action: "replace", target: existing[0] } })).toThrow("same saved workflow");
});
it("keeps generated collision names and IDs within UTF-8 bounds", () => {
  const unicode = { ...wf, id: "😀".repeat(30), name: "😀".repeat(40) };
  const existing = validateWorkflowList([unicode]);
  const merged = mergeWorkflowImport(existing, [unicode], { 0: { action: "keep-both" } });
  expect(new TextEncoder().encode(merged[1].name).length).toBeLessThanOrEqual(160);
  expect(new TextEncoder().encode(merged[1].id).length).toBeLessThanOrEqual(120);
});
