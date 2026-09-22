export type WorkflowInput = { name: string; label: string; type: "text" | "number" | "path" | "secret"; defaultValue?: string; required: boolean };
export type Workflow = { id: string; name: string; steps: string[]; description?: string; stopOnError?: boolean; stepTitles?: string[]; inputs?: WorkflowInput[] };
export const MAX_WORKFLOW_BYTES = 1024 * 1024;
export const bytes = (text: string) => new TextEncoder().encode(text).length;
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function text(value: unknown, max: number, label: string, empty = false): string {
  if (typeof value !== "string" || (!empty && !value.trim()) || bytes(value) > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error(`${label} must be ${empty ? "text" : "nonempty text"} of at most ${max} UTF-8 bytes, without control characters.`);
  return value;
}
export function validateWorkflow(raw: unknown): Workflow {
  if (!object(raw)) throw new Error("Each workflow must be an object.");
  const id = text(raw.id, 120, "Workflow ID");
  const name = text(raw.name, 160, "Workflow name").trim();
  if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 100) throw new Error("A workflow needs 1–100 command steps.");
  const steps = raw.steps.map((step, i) => text(step, 8000, `Step ${i + 1}`));
  if (raw.stopOnError !== undefined && typeof raw.stopOnError !== "boolean") throw new Error("stopOnError must be a boolean.");
  const result: Workflow = { id, name, steps, stopOnError: raw.stopOnError !== false };
  if (raw.description !== undefined) result.description = text(raw.description, 2000, "Description", true);
  if (raw.stepTitles !== undefined) {
    if (!Array.isArray(raw.stepTitles) || raw.stepTitles.length !== steps.length) throw new Error("Step titles must match the number of commands.");
    result.stepTitles = raw.stepTitles.map((title) => text(title, 160, "Step title", true));
  }
  if (raw.inputs !== undefined) {
    if (!Array.isArray(raw.inputs) || raw.inputs.length > 32) throw new Error("A workflow supports at most 32 inputs.");
    const names = new Set<string>();
    result.inputs = raw.inputs.map((input): WorkflowInput => {
      if (!object(input)) throw new Error("Each input must be an object.");
      const inputName = text(input.name, 64, "Input name");
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(inputName) || ["__proto__", "constructor", "prototype"].includes(inputName)) throw new Error("Input names must be identifiers, not reserved object names.");
      if (names.has(inputName)) throw new Error(`Duplicate input name: ${inputName}`);
      names.add(inputName);
      if (!["text", "number", "path", "secret"].includes(String(input.type))) throw new Error("Input type must be text, number, path, or secret.");
      if (typeof input.required !== "boolean") throw new Error("Input required must be a boolean.");
      const next: WorkflowInput = { name: inputName, label: text(input.label, 160, "Input label"), type: input.type as WorkflowInput["type"], required: input.required };
      if (input.defaultValue !== undefined) {
        if (next.type === "secret") throw new Error("Secret inputs cannot have saved defaults.");
        next.defaultValue = text(input.defaultValue, 2000, "Input default", true);
        if (/[\r\n\t\u2028\u2029]/.test(next.defaultValue)) throw new Error("Input defaults must be single-line values.");
        if (next.type === "number" && next.defaultValue !== "" && !isWorkflowNumber(next.defaultValue)) throw new Error("Number input defaults must be finite numbers.");
      }
      return next;
    });
  }
  return result;
}
export function isWorkflowNumber(value: string): boolean { return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value)); }
export function validateWorkflowList(value: unknown): Workflow[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error("Workflow collection must be an array of at most 500 workflows.");
  const list = value.map(validateWorkflow);
  if (new Set(list.map((wf) => wf.id)).size !== list.length) throw new Error("Workflow IDs must be unique.");
  if (bytes(JSON.stringify({ items: list, dismissed: [] })) > MAX_WORKFLOW_BYTES) throw new Error("Workflow collection exceeds 1 MiB.");
  return list;
}
