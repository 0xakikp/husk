/**
 * Parameterized runbook helpers (pure). Steps may contain `{{name}}` or
 * `{{name=default}}` placeholders. Mirrors the logic I wrote for the husk
 * workflows feature; reused here.
 */

export type WorkflowParam = { name: string; default: string | null };

const PARAM_PATTERN = "\\{\\{\\s*([A-Za-z0-9_]+)\\s*(?:=\\s*([^}]*?))?\\s*\\}\\}";

function paramRe(): RegExp {
  return new RegExp(PARAM_PATTERN, "g");
}

export function extractParams(steps: string[]): WorkflowParam[] {
  const seen = new Map<string, string | null>();
  const re = paramRe();
  for (const step of steps) {
    re.lastIndex = 0;
    let m = re.exec(step);
    while (m !== null) {
      const name = m[1];
      const def = m[2] !== undefined ? m[2] : null;
      if (!seen.has(name)) seen.set(name, def);
      else if (seen.get(name) === null && def !== null) seen.set(name, def);
      m = re.exec(step);
    }
  }
  return [...seen.entries()].map(([name, default_]) => ({ name, default: default_ }));
}

export function substituteParams(text: string, values: Record<string, string>): string {
  return text.replace(paramRe(), (_full, name: string, def?: string) => {
    const v = values[name];
    if (v != null && v !== "") return v;
    return def ?? "";
  });
}

export function composeCommand(
  steps: string[],
  values: Record<string, string>,
  opts: { stopOnError?: boolean } = {},
): string {
  const sep = opts.stopOnError === false ? "; " : " && ";
  return steps
    .map((s) => substituteParams(s, values).trim())
    .filter((s) => s.length > 0)
    .join(sep);
}
