/** Plugins declare arbitrary local executables, not sandboxed code. Views
 * require explicit trust; row actions are reviewed/staged, never auto-run. */
import { buildPluginActionCommand, pluginCommandArgv } from "./command";
export { buildPluginActionCommand } from "./command";

export type PluginFormat = "table" | "lines" | "json";
export type PluginAction = {
  label: string;
  /** `{Column}` inserts a literal argument after template tokenization. */
  command: string;
  /** Legacy author hint only; never permission to execute. */
  run?: boolean;
};
export type PluginView = {
  title: string;
  command: string;
  format?: PluginFormat;
  columns?: string[];
  /** Suggested seconds; UI requires a separate refresh opt-in. */
  refresh?: number;
  empty?: string;
  actions?: PluginAction[];
};
export type Plugin = { id: string; name: string; description?: string; brand?: string; views: PluginView[] };
export const MAX_PLUGIN_VIEWS = 20;
export const MAX_PLUGIN_COLUMNS = 64;
const FORMATS: PluginFormat[] = ["table", "lines", "json"];
const bytes = (value: string) => new TextEncoder().encode(value).length;
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function string(value: unknown, max: number, label: string, required = true): string {
  if (typeof value !== "string" || (required && !value.trim()) || bytes(value) > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error(`${label} must be ${required ? "nonempty text" : "text"} of at most ${max} UTF-8 bytes, without control characters.`);
  return value;
}

/** Reject invalid declarations; never silently truncate commands or actions. */
export function parsePlugin(id: string, raw: unknown): { plugin: Plugin } | { error: string } {
  try {
    string(id, 160, "Plugin id");
    if (!object(raw)) throw new Error("Plugin must be a JSON object.");
    const name = raw.name === undefined ? id : string(raw.name, 160, "Plugin name").trim();
    const description = raw.description === undefined ? undefined : string(raw.description, 2_000, "Description", false);
    const brand = raw.brand === undefined ? undefined : string(raw.brand, 9, "Brand");
    if (brand && !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(brand)) throw new Error("Brand must be a hexadecimal colour such as #00CA8E.");
    if (!Array.isArray(raw.views) || !raw.views.length || raw.views.length > MAX_PLUGIN_VIEWS) throw new Error(`Plugin needs between 1 and ${MAX_PLUGIN_VIEWS} views.`);
    const views = raw.views.map((item, index): PluginView => {
      const label = `View ${index + 1}`;
      if (!object(item)) throw new Error(`${label} must be an object.`);
      const title = item.title === undefined ? name : string(item.title, 160, `${label} title`).trim();
      const command = string(item.command, 8_000, `${label} command`).trim();
      try { pluginCommandArgv(command); } catch (cause) { throw new Error(`${label}: ${cause instanceof Error ? cause.message : "invalid command"}`); }
      const format = item.format === undefined ? "table" : item.format;
      if (!FORMATS.includes(format as PluginFormat)) throw new Error(`${label} format must be table, lines or json.`);
      let columns: string[] | undefined;
      if (item.columns !== undefined) {
        if (!Array.isArray(item.columns) || item.columns.length > MAX_PLUGIN_COLUMNS) throw new Error(`${label} columns must be a list of at most ${MAX_PLUGIN_COLUMNS} names.`);
        columns = item.columns.map((column) => string(column, 160, `${label} column`));
        if (new Set(columns).size !== columns.length) throw new Error(`${label} column names must be unique.`);
      }
      let refresh: number | undefined;
      if (item.refresh !== undefined) {
        if (typeof item.refresh !== "number" || !Number.isFinite(item.refresh) || item.refresh < 2 || item.refresh > 86_400) throw new Error(`${label} refresh must be a finite interval between 2 and 86,400 seconds, or omitted.`);
        refresh = item.refresh;
      }
      const empty = item.empty === undefined ? undefined : string(item.empty, 1_000, `${label} empty message`, false);
      let actions: PluginAction[] = [];
      if (item.actions !== undefined) {
        if (!Array.isArray(item.actions) || item.actions.length > 20) throw new Error(`${label} actions must be a list of at most 20 actions.`);
        actions = item.actions.map((action, actionIndex): PluginAction => {
          const actionLabel = `${label}, action ${actionIndex + 1}`;
          if (!object(action)) throw new Error(`${actionLabel} must be an object.`);
          const actionName = string(action.label, 160, `${actionLabel} label`).trim();
          const actionCommand = string(action.command, 8_000, `${actionLabel} command`).trim();
          try { pluginCommandArgv(actionCommand, true); } catch (cause) { throw new Error(`${actionLabel}: ${cause instanceof Error ? cause.message : "invalid command"}`); }
          if (action.run !== undefined && typeof action.run !== "boolean") throw new Error(`${actionLabel} run must be a boolean.`);
          return { label: actionName, command: actionCommand, run: action.run === true };
        });
      }
      return { title, command, format: format as PluginFormat, columns, refresh, empty, actions };
    });
    return { plugin: { id, name, description, brand, views } };
  } catch (cause) { return { error: cause instanceof Error ? cause.message : "Invalid plugin declaration." }; }
}

/** Kept for compatibility; interpolation now uses the reviewed argv contract. */
export function fillTemplate(template: string, row: Record<string, string>): string {
  return buildPluginActionCommand({ command: template }, row);
}
