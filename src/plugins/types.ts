/**
 * Husk plugins are data, not code.
 *
 * A plugin is a JSON file describing a command to run, how to read its output,
 * and what its rows can do. Husk renders it with its own components, so a plugin
 * inherits the app's look automatically and keeps it when the app is restyled —
 * which is the whole reason for this shape. Code plugins would each draw their
 * own UI and drift apart from the app immediately.
 *
 * It is also the security story. A plugin never executes JavaScript; it names a
 * program and arguments, which go to `shell_run_command` as program + argv with
 * no shell in between, so nothing in a plugin file can inject shell syntax. The
 * worst a plugin can do is run a command its author could have typed in the
 * terminal anyway — and the file is short enough to read before trusting it.
 */

export type PluginFormat = "table" | "lines" | "json";

export type PluginAction = {
  label: string;
  /** `{Column}` is replaced with that column's value for the clicked row. */
  command: string;
  /** Run immediately. Default is to type it into the terminal so args can be
   *  added first, and so a mis-click cannot execute anything. */
  run?: boolean;
};

export type PluginView = {
  title: string;
  /** Whole command line, e.g. "nomad job status". Split into program + argv. */
  command: string;
  /** table = whitespace columns with a header row (kubectl/docker style). */
  format?: PluginFormat;
  /** table/json: which columns to show, in order. Omit for all of them. */
  columns?: string[];
  /** Auto-refresh interval in seconds. Omit for manual refresh only. */
  refresh?: number;
  /** Shown when the command succeeds with no rows. */
  empty?: string;
  actions?: PluginAction[];
};

export type Plugin = {
  /** Filename without extension — stable, and unique per folder for free. */
  id: string;
  name: string;
  description?: string;
  /** Accent for the plugin's icon tile, e.g. "#00CA8E". */
  brand?: string;
  views: PluginView[];
};

const FORMATS: PluginFormat[] = ["table", "lines", "json"];

/**
 * Validate an untrusted parsed JSON object into a Plugin.
 *
 * Returns the plugin or a reason, never throws and never a partial plugin: a
 * half-valid plugin would fail later at render time, where the cause is much
 * harder to see than at load.
 */
export function parsePlugin(id: string, raw: unknown): { plugin: Plugin } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "not a JSON object" };
  const o = raw as Record<string, unknown>;

  const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : id;
  if (!Array.isArray(o.views) || o.views.length === 0) return { error: "needs at least one view" };

  const views: PluginView[] = [];
  for (const [i, v] of (o.views as unknown[]).entries()) {
    if (typeof v !== "object" || v === null) return { error: `view ${i + 1} is not an object` };
    const vo = v as Record<string, unknown>;

    if (typeof vo.command !== "string" || !vo.command.trim()) {
      return { error: `view ${i + 1} has no command` };
    }
    const format = vo.format === undefined ? "table" : vo.format;
    if (typeof format !== "string" || !FORMATS.includes(format as PluginFormat)) {
      return { error: `view ${i + 1}: format must be one of ${FORMATS.join(", ")}` };
    }

    const actions: PluginAction[] = [];
    if (vo.actions !== undefined) {
      if (!Array.isArray(vo.actions)) return { error: `view ${i + 1}: actions must be a list` };
      for (const [j, a] of (vo.actions as unknown[]).entries()) {
        const ao = a as Record<string, unknown>;
        if (typeof ao?.label !== "string" || typeof ao?.command !== "string") {
          return { error: `view ${i + 1}, action ${j + 1}: needs a label and a command` };
        }
        actions.push({ label: ao.label, command: ao.command, run: ao.run === true });
      }
    }

    views.push({
      title: typeof vo.title === "string" && vo.title.trim() ? vo.title.trim() : name,
      command: vo.command.trim(),
      format: format as PluginFormat,
      columns: Array.isArray(vo.columns) ? (vo.columns as unknown[]).filter((c): c is string => typeof c === "string") : undefined,
      // Floored at 2s: a plugin asking to refresh every 100ms would spawn
      // processes faster than they finish.
      refresh: typeof vo.refresh === "number" && vo.refresh > 0 ? Math.max(2, vo.refresh) : undefined,
      empty: typeof vo.empty === "string" ? vo.empty : undefined,
      actions,
    });
  }

  return {
    plugin: {
      id,
      name,
      description: typeof o.description === "string" ? o.description : undefined,
      brand: typeof o.brand === "string" ? o.brand : undefined,
      views,
    },
  };
}

/** Substitute `{Column}` placeholders from a row. Unknown names are left alone. */
export function fillTemplate(template: string, row: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (whole, key: string) => {
    const value = row[key.trim()];
    return value === undefined ? whole : value;
  });
}
