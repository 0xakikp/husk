import { invoke } from "@tauri-apps/api/core";
import { shq } from "./lib/shellQuote";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

/**
 * Detect which of `bins` are installed. Runs through a login shell with
 * Homebrew's environment loaded first, so detection sees the user's real PATH
 * rather than the minimal PATH a GUI-launched app inherits (the classic macOS
 * "it's installed but the app can't find it" problem).
 */
export async function detectInstalled(bins: string[]): Promise<Set<string>> {
  if (bins.length === 0) return new Set();
  const list = bins.map(shq).join(" ");
  const script =
    '[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"; ' +
    '[ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"; ' +
    `for b in ${list}; do command -v "$b" >/dev/null 2>&1 && printf '%s\\n' "$b"; done`;
  try {
    const out = await invoke<ShellOutput>("shell_run_command", {
      command: script,
      cwd: null,
      timeout_secs: 10,
    });
    return new Set(
      out.stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}
