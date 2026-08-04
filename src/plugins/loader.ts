import { invoke } from "@tauri-apps/api/core";
import { readDir, readFile } from "../fs";
import { tokenizeCommand } from "../lib/shellQuote";
import { parsePlugin, type Plugin, type PluginView } from "./types";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

export type LoadedPlugin = { plugin: Plugin } | { id: string; error: string };

/** Read and validate every `*.json` in the plugins folder. */
export async function loadPlugins(dir: string): Promise<LoadedPlugin[]> {
  if (!dir) return [];
  let files: { name: string; path: string }[];
  try {
    files = (await readDir(dir))
      .filter((e) => !e.is_dir && e.name.toLowerCase().endsWith(".json"))
      .map((e) => ({ name: e.name, path: e.path }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch {
    return [];
  }

  /* Failures are surfaced as rows, not skipped. A plugin that silently fails to
     appear is the worst outcome for whoever is writing it — they cannot tell a
     typo from an unsupported feature. */
  return Promise.all(
    files.map(async ({ name, path }): Promise<LoadedPlugin> => {
      const id = name.replace(/\.json$/i, "");
      try {
        const parsed = parsePlugin(id, JSON.parse(await readFile(path)) as unknown);
        return "plugin" in parsed ? parsed : { id, error: parsed.error };
      } catch (e) {
        return { id, error: e instanceof Error ? e.message : "could not be read" };
      }
    }),
  );
}

export type PluginRows = {
  columns: string[];
  rows: Record<string, string>[];
  error?: string;
};

/** Split a whitespace-column table (kubectl/docker style) into rows. */
function parseTable(stdout: string, wanted?: string[]): PluginRows {
  const lines = stdout.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { columns: [], rows: [] };

  // Two or more spaces separate columns; one space can appear inside a value,
  // which is why splitting on single spaces breaks on real command output.
  const header = lines[0].trim().split(/\s{2,}/);
  const rows = lines.slice(1).map((line) => {
    const cells = line.trim().split(/\s{2,}/);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });

  const columns = wanted?.length ? wanted.filter((c) => header.includes(c)) : header;
  return { columns: columns.length ? columns : header, rows };
}

function parseLines(stdout: string): PluginRows {
  const rows = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => ({ Output: l }));
  return { columns: ["Output"], rows };
}

function parseJson(stdout: string, wanted?: string[]): PluginRows {
  const data = JSON.parse(stdout) as unknown;
  const list = Array.isArray(data) ? data : [data];
  const rows = list.map((item) => {
    const row: Record<string, string> = {};
    if (typeof item === "object" && item !== null) {
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        // Scalars only. A nested object rendered as [object Object] is worse
        // than omitting it, and a table cell is the wrong place for one.
        if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
          row[k] = String(v ?? "");
        }
      }
    }
    return row;
  });
  const keys = wanted?.length ? wanted : Object.keys(rows[0] ?? {});
  return { columns: keys, rows };
}

/**
 * Run a view's command and parse its output.
 *
 * The command is tokenised into program + argv and handed to shell_run_command,
 * so it never passes through a shell — a plugin cannot smuggle `;` or `$(…)`
 * into something that would be interpreted.
 */
export async function runView(view: PluginView, cwd: string | null): Promise<PluginRows> {
  const parts = tokenizeCommand(view.command);
  if (parts.length === 0) return { columns: [], rows: [], error: "empty command" };

  let out: ShellOutput;
  try {
    out = await invoke<ShellOutput>("shell_run_command", {
      program: parts[0],
      args: parts.slice(1),
      cwd,
      timeout_secs: 20,
    });
  } catch (e) {
    return { columns: [], rows: [], error: e instanceof Error ? e.message : String(e) };
  }

  if (out.exit_code !== 0) {
    // stderr first: a plugin author debugging a wrong flag needs the tool's own
    // message, not "exit 1".
    return { columns: [], rows: [], error: (out.stderr || out.stdout).trim() || `exited ${out.exit_code}` };
  }

  return parseOutput(view, out.stdout);
}

/**
 * Turn command output into rows. Split out from runView so it can be tested
 * without a shell — the table splitter is the default path and the easiest to
 * get subtly wrong.
 */
export function parseOutput(view: PluginView, stdout: string): PluginRows {
  try {
    if (view.format === "lines") return parseLines(stdout);
    if (view.format === "json") return parseJson(stdout, view.columns);
    return parseTable(stdout, view.columns);
  } catch (e) {
    return { columns: [], rows: [], error: e instanceof Error ? e.message : "could not parse output" };
  }
}
