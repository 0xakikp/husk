import { readDir } from "../fs";

/**
 * The scripts folder.
 *
 * This is the one job the Vault's Bookmarks tab never did. Bookmarks stored
 * directories, files and commands — three unrelated things, and all three were
 * already better served: files by the launcher's `f:` scope, commands by shell
 * history and Workflows, directories by `cd` plus history. A folder of runnable
 * scripts is different: the thing you want is a file on disk, and what you want
 * to do with it is run it with arguments.
 */

export type ScriptFile = {
  path: string;
  name: string;
  /** Lowercase extension without the dot, "" when there is none. */
  ext: string;
  /** Human label for the runtime, for the row's secondary text. */
  lang: string;
};

/** Extension → how to run it, and what to call it. */
const RUNNERS: Record<string, { cmd: (p: string) => string; lang: string }> = {
  sh: { cmd: (p) => `bash ${q(p)}`, lang: "shell" },
  bash: { cmd: (p) => `bash ${q(p)}`, lang: "bash" },
  zsh: { cmd: (p) => `zsh ${q(p)}`, lang: "zsh" },
  fish: { cmd: (p) => `fish ${q(p)}`, lang: "fish" },
  py: { cmd: (p) => `python3 ${q(p)}`, lang: "python" },
  rb: { cmd: (p) => `ruby ${q(p)}`, lang: "ruby" },
  pl: { cmd: (p) => `perl ${q(p)}`, lang: "perl" },
  lua: { cmd: (p) => `lua ${q(p)}`, lang: "lua" },
  js: { cmd: (p) => `node ${q(p)}`, lang: "node" },
  mjs: { cmd: (p) => `node ${q(p)}`, lang: "node" },
  cjs: { cmd: (p) => `node ${q(p)}`, lang: "node" },
  ps1: { cmd: (p) => `pwsh -File ${q(p)}`, lang: "powershell" },
};

/** Extensions we list. Anything else in the folder is not a script. */
const SCRIPT_EXT = new Set([...Object.keys(RUNNERS), "ts", "tsx"]);

function q(path: string): string {
  // Single quotes, with any embedded single quote closed and re-opened. Handles
  // spaces and every shell metacharacter a filename can legally contain.
  return `'${path.replace(/'/g, `'\\''`)}'`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

/**
 * The command that runs this script.
 *
 * Unknown extensions and extensionless files fall through to executing the path
 * directly, which is right rather than lazy: those are the files that carry a
 * shebang, and the shell already knows what to do with them.
 */
export function runCommandFor(path: string): string {
  const runner = RUNNERS[extOf(path)];
  return runner ? runner.cmd(path) : q(path);
}

export async function listScripts(dir: string): Promise<ScriptFile[]> {
  if (!dir) return [];
  try {
    const entries = await readDir(dir);
    return entries
      .filter((e) => !e.is_dir && !e.name.startsWith("."))
      .map((e) => ({ path: e.path, name: e.name, ext: extOf(e.name) }))
      // Extensionless files are kept: a shebang'd `deploy` with no suffix is a
      // script, and excluding it would miss the most common shape of all.
      .filter((e) => e.ext === "" || SCRIPT_EXT.has(e.ext))
      .map((e) => ({ ...e, lang: RUNNERS[e.ext]?.lang ?? (e.ext || "executable") }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch {
    return [];
  }
}
