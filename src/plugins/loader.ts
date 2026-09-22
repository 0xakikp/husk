import { invoke } from "@tauri-apps/api/core";
import { readDir, readFileScoped } from "../fs";
import { pluginCommandArgv } from "./command";
import { MAX_PLUGIN_COLUMNS, parsePlugin, type Plugin, type PluginView } from "./types";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null; timed_out?: boolean; truncated?: boolean };
export type LoadedPlugin = { plugin: Plugin } | { id: string; error: string };
export const MAX_PLUGIN_FILES = 100;
export const MAX_PLUGIN_FILE_BYTES = 128 * 1024;
export const MAX_PLUGIN_OUTPUT_BYTES = 1024 * 1024;
export const MAX_PLUGIN_ROWS = 200;
const MAX_CELL_BYTES = 8_000;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const errorText = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).replace(/[\x00-\x1f\x7f]/g, " ").slice(0, 500);

/** Folder errors are distinct from a successfully loaded, empty folder. Read
 * at most four files concurrently and enforce size/scope in the native read. */
export async function loadPlugins(dir: string): Promise<LoadedPlugin[]> {
  if (!dir) return [];
  let files;
  try {
    files = (await readDir(dir)).filter((entry) => !entry.is_dir && entry.name.toLowerCase().endsWith(".json"))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch (cause) { throw new Error(`Could not read the plugins folder: ${errorText(cause)}`); }
  if (files.length > MAX_PLUGIN_FILES) throw new Error(`The plugins folder contains more than ${MAX_PLUGIN_FILES} JSON files. Choose a smaller folder.`);
  const loaded: LoadedPlugin[] = [];
  for (let index = 0; index < files.length; index += 4) {
    loaded.push(...await Promise.all(files.slice(index, index + 4).map(async ({ name, path }): Promise<LoadedPlugin> => {
      const id = name.replace(/\.json$/i, "");
      try {
        const contents = await readFileScoped(path, dir, MAX_PLUGIN_FILE_BYTES);
        if (bytes(contents) > MAX_PLUGIN_FILE_BYTES) throw new Error("Plugin JSON exceeds 128 KiB.");
        let raw: unknown;
        try { raw = JSON.parse(contents); } catch { throw new Error("Plugin file is not valid JSON."); }
        const parsed = parsePlugin(id, raw);
        return "plugin" in parsed ? parsed : { id, error: parsed.error };
      } catch (cause) { return { id, error: errorText(cause) }; }
    })));
  }
  return loaded;
}

export type PluginRows = {
  columns: string[];
  rows: Record<string, string>[];
  error?: string;
  status?: "ok" | "error" | "timed-out" | "truncated" | "cancelled";
  truncated?: boolean;
  notice?: string;
};
function failure(error: string, status: PluginRows["status"] = "error"): PluginRows { return { columns: [], rows: [], error, status }; }
function dictionary(): Record<string, string> { return Object.create(null) as Record<string, string>; }
function cell(value: string): string {
  if (bytes(value) > MAX_CELL_BYTES) throw new Error("A plugin output cell exceeds 8,000 UTF-8 bytes. No partial cell is available for actions.");
  return value;
}
function columnsChecked(columns: string[]): string[] {
  if (columns.length > MAX_PLUGIN_COLUMNS) throw new Error(`Plugin output exceeds ${MAX_PLUGIN_COLUMNS} columns.`);
  if (columns.some((name) => !name.trim() || bytes(name) > 160 || /[\x00-\x1f\x7f]/.test(name))) throw new Error("Plugin output has an invalid or oversized column name.");
  if (new Set(columns).size !== columns.length) throw new Error("Plugin output has duplicate column names; row actions would be ambiguous.");
  return columns;
}
function selectedColumns(actual: string[], wanted?: string[]) {
  columnsChecked(actual);
  if (!wanted?.length) return actual;
  columnsChecked(wanted);
  const missing = wanted.filter((name) => !actual.includes(name));
  if (missing.length) throw new Error(`Requested output columns were not found: ${missing.join(", ").slice(0, 240)}.`);
  return wanted;
}
function result(columns: string[], rows: Record<string, string>[], omitted: boolean): PluginRows {
  return { columns, rows, status: omitted ? "truncated" : "ok", ...(omitted ? { truncated: true, notice: `Showing the first ${MAX_PLUGIN_ROWS} complete rows; additional rows were omitted.` } : {}) };
}
function parseTable(stdout: string, wanted?: string[]): PluginRows {
  const lines = stdout.split("\n").filter((line) => line.trim());
  if (!lines.length) return result([], [], false);
  const header = columnsChecked(lines[0].trim().split(/\s{2,}/));
  const rows = lines.slice(1, MAX_PLUGIN_ROWS + 1).map((line) => {
    const cells = line.trim().split(/\s{2,}/);
    if (cells.length > header.length) throw new Error("Output row has more cells than its header. Use JSON for unambiguous row actions.");
    const row = dictionary();
    header.forEach((name, index) => { row[name] = cell(cells[index] ?? ""); });
    return row;
  });
  return result(selectedColumns(header, wanted), rows, lines.length > MAX_PLUGIN_ROWS + 1);
}
function parseLines(stdout: string): PluginRows {
  const lines = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  const rows = lines.slice(0, MAX_PLUGIN_ROWS).map((line) => { const row = dictionary(); row.Output = cell(line); return row; });
  return result(["Output"], rows, lines.length > MAX_PLUGIN_ROWS);
}
function parseJson(stdout: string, wanted?: string[]): PluginRows {
  let data: unknown;
  try { data = JSON.parse(stdout); } catch { throw new Error("Command output is not valid JSON."); }
  const list = Array.isArray(data) ? data : [data];
  const keys = new Set<string>();
  let nested = false;
  const rows = list.slice(0, MAX_PLUGIN_ROWS).map((item) => {
    const row = dictionary();
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      for (const [key, value] of Object.entries(item)) {
        if (value === null || ["string", "number", "boolean"].includes(typeof value)) { row[key] = cell(String(value)); keys.add(key); }
        else nested = true;
      }
    } else if (item === null || ["string", "number", "boolean"].includes(typeof item)) { row.Value = cell(String(item)); keys.add("Value"); }
    else throw new Error("JSON rows must be objects with scalar fields or scalar values, not nested arrays.");
    return row;
  });
  if (rows.length && !keys.size) throw new Error("JSON output has no scalar columns to display.");
  const parsed = result(selectedColumns([...keys], wanted), rows, list.length > MAX_PLUGIN_ROWS);
  if (nested) parsed.notice = [parsed.notice, "Nested object fields are not displayed; only scalar values are available to actions."].filter(Boolean).join(" ");
  return parsed;
}

/** Bound display independently of native stdout limits. Oversized cells are
 * rejected, not silently clipped into a different actionable row value. */
export function parseOutput(view: PluginView, stdout: string): PluginRows {
  try {
    if (typeof stdout !== "string" || bytes(stdout) > MAX_PLUGIN_OUTPUT_BYTES) return { ...failure("Plugin output exceeds the 1 MiB display limit. Narrow the command output.", "truncated"), truncated: true };
    if (!stdout.trim()) return result([], [], false);
    if (view.format === "lines") return parseLines(stdout);
    if (view.format === "json") return parseJson(stdout, view.columns);
    return parseTable(stdout, view.columns);
  } catch (cause) { return failure(errorText(cause)); }
}

/** Abort signals suppress results, not the native process. Keep the promise
 * pending until native settlement so UI single-flight guards remain truthful. */
export async function runView(view: PluginView, cwd: string | null, options: { signal?: AbortSignal } = {}): Promise<PluginRows> {
  const cancelled = () => failure("Stopped waiting for this plugin command. Any native work already started may continue until its timeout.", "cancelled");
  if (options.signal?.aborted) return failure("Plugin command was cancelled before it started.", "cancelled");
  let argv: string[];
  try { argv = pluginCommandArgv(view.command); } catch (cause) { return failure(errorText(cause)); }
  let out: ShellOutput;
  try {
    out = await invoke<ShellOutput>("shell_run_command", { program: argv[0], args: argv.slice(1), cwd, timeout_secs: 20 });
  } catch (cause) { return options.signal?.aborted ? cancelled() : failure(errorText(cause)); }
  if (options.signal?.aborted) return cancelled();
  if (out.timed_out) return failure("Plugin command timed out after 20 seconds. No rows were accepted.", "timed-out");
  if (out.truncated) return { ...failure("Command output was truncated by the native output limit. Narrow the command output before using row actions.", "truncated"), truncated: true };
  if (out.exit_code !== 0) {
    const details = errorText((out.stderr || out.stdout || "").trim());
    return failure(`Plugin command ${out.exit_code == null ? "ended without an exit code" : `exited ${out.exit_code}`}${details ? `: ${details}` : "."}`);
  }
  return parseOutput(view, out.stdout);
}
