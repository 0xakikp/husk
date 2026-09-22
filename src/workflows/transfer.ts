import { scanForSecrets } from "../ai/contextItems";
import { extractParams, getWorkflowInputs } from "./params";
import { bytes, MAX_WORKFLOW_BYTES, object, validateWorkflowList, type Workflow } from "./schema";

export function assertShareableWorkflows(list: Workflow[]): void {
  for (const wf of list) {
    const reasons = [wf.name, wf.description ?? "", ...(wf.stepTitles ?? []),
      ...wf.steps.map((step) => step.replace(/\{\{\s*[A-Za-z0-9_]+\s*(?:=\s*[^}]*?)?\s*\}\}/g, "INPUT")),
      ...extractParams(wf.steps).map((input) => input.name + "=" + (input.default ?? "")),
      ...(wf.inputs ?? []).map((input) => input.name + "=" + (input.defaultValue ?? ""))].flatMap((part) => scanForSecrets("workflow definition", part));
    // Defaults belonging to credential-like names must be runtime-only even if
    // their short values do not match a provider's token signature.
    const credentialDefault = wf.inputs?.some((input) => input.defaultValue && /token|secret|password|credential|api.?key/i.test(input.name + " " + input.label));
    const inlineCredential = extractParams(wf.steps).some((input) => input.default && /token|secret|password|credential|api.?key/i.test(input.name));
    const literalCredential = wf.steps.some((step) => [...step.matchAll(/(?:\b[A-Za-z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|API_KEY)[A-Za-z0-9_]*\s*=\s*|--(?:password|passwd|token|api-key|secret)(?:\s+|=))(?:"([^"]*)"|'([^']*)'|(\{\{[^}]+\}\}|[^\s;]+))/gi)].some((match) => {
      const value = match[1] ?? match[2] ?? match[3];
      return value && !/^\{\{\s*[A-Za-z0-9_]+\s*\}\}$/.test(value);
    }));
    getWorkflowInputs(wf);
    if (reasons.length || credentialDefault || inlineCredential || literalCredential) throw new Error("Possible credentials in a workflow definition. Replace them with a secret runtime input before saving or sharing.");
  }
}
export function exportWorkflowJson(workflows: Workflow[]): string {
  const list = validateWorkflowList(workflows); assertShareableWorkflows(list);
  const payload = JSON.stringify({ format: "husk-workflows", version: 1, workflows: list }, null, 2);
  if (bytes(payload) > MAX_WORKFLOW_BYTES) throw new Error("Export exceeds 1 MiB. Export fewer workflows.");
  return payload;
}
export function parseWorkflowImport(json: string): Workflow[] {
  if (bytes(json) > MAX_WORKFLOW_BYTES) throw new Error("Import exceeds 1 MiB.");
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { throw new Error("This is not valid JSON."); }
  if (object(raw) && ("version" in raw || "format" in raw || "workflows" in raw)) {
    if (raw.format !== "husk-workflows" || raw.version !== 1) throw new Error("Unsupported workflow format/version. Expected husk-workflows version 1.");
    raw = raw.workflows;
  } else if (object(raw)) raw = [raw]; // Legacy Copy workflow JSON.
  if (!Array.isArray(raw) || !raw.length) throw new Error("Import needs at least one workflow.");
  // Canonical projection deliberately discards unrelated runtime/UI fields.
  const list = validateWorkflowList(raw); assertShareableWorkflows(list);
  return list;
}
export type WorkflowImportChoice = { action: "keep-both" } | { action: "skip" } | { action: "replace"; target: Workflow };
function appendBounded(text: string, suffix: string, limit: number): string {
  const points = Array.from(text);
  while (bytes(points.join("") + suffix) > limit) points.pop();
  return points.join("") + suffix;
}
export function getWorkflowImportConflicts(existing: Workflow[], incoming: Workflow[]) {
  return incoming.map((workflow, index) => ({ index, incoming: workflow, matches: existing.filter((saved) => saved.id === workflow.id || saved.name.toLocaleLowerCase() === workflow.name.toLocaleLowerCase()) }));
}
export function mergeWorkflowImport(existing: Workflow[], incoming: Workflow[], choices: Record<number, WorkflowImportChoice>): Workflow[] {
  let result = validateWorkflowList(existing);
  const usedReplacements = new Set<string>();
  for (const { index, incoming: wf, matches } of getWorkflowImportConflicts(existing, validateWorkflowList(incoming))) {
    const choice = Object.prototype.hasOwnProperty.call(choices, index) ? choices[index] : undefined;
    if (choice?.action === "skip") continue;
    if (choice?.action === "replace") {
      const target = matches.find((item) => item.id === choice.target.id);
      if (!target || JSON.stringify(target) !== JSON.stringify(choice.target)) throw new Error("A replacement target changed. Preview the import again.");
      if (usedReplacements.has(target.id)) throw new Error("Two imports cannot replace the same saved workflow. Keep both or skip one.");
      usedReplacements.add(target.id);
      result = result.map((item) => item.id === target.id ? { ...wf, id: target.id } : item);
      continue;
    }
    if (matches.length && !choice) throw new Error("Choose Keep both, Replace, or Skip for every conflict.");
    let id = wf.id; let name = wf.name; let number = 2;
    while (result.some((item) => item.id === id)) id = appendBounded(wf.id, "_import_" + number++, 120);
    number = 2;
    while (result.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      name = appendBounded(wf.name, " (" + number++ + ")", 160);
    }
    result.push({ ...wf, id, name });
  }
  return validateWorkflowList(result);
}
