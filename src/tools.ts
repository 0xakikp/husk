import { invoke } from "@tauri-apps/api/core";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

/**
 * Detect which of `bins` are installed. Asks the Rust backend to run
 * `command -v` through the user's login shell so Homebrew and other PATH
 * modifications are applied, matching the behaviour of an interactive shell.
 */
export async function detectInstalled(bins: string[]): Promise<Set<string>> {
  if (bins.length === 0) return new Set();
  try {
    const installed = await invoke<string[]>("detect_binaries", { bins });
    return new Set(installed);
  } catch {
    return new Set();
  }
}

export type { ShellOutput };
export { invoke };
