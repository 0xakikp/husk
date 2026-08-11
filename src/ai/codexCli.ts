import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * The signed-in `codex` CLI as an AI backend.
 *
 * Husk never reads Codex's local auth state or turns it into an API key. It
 * asks the CLI to answer instead, so usage is governed by the account already
 * signed into Codex. `codex exec --json` emits JSONL, which the Rust bridge
 * forwards one line at a time.
 */

let availability: Promise<boolean> | null = null;
let models: Promise<CodexCliModel[]> | null = null;

export type CodexCliModel = {
  id: string;
  label: string;
  description: string;
};

export function codexCliAvailable(refresh = false): Promise<boolean> {
  if (refresh) availability = null;
  availability ??= invoke<boolean>("codex_cli_available").catch(() => false);
  return availability;
}

/** Models are discovered from this user's Codex cache, not hard-coded. */
export function codexCliModels(): Promise<CodexCliModel[]> {
  models ??= invoke<CodexCliModel[]>("codex_cli_models").catch(() => []);
  return models;
}

/** Codex may add JSONL event variants between CLI releases, so unknown fields
 * are intentionally optional and safely ignored. */
type CodexEvent = {
  type: string;
  item?: { type?: string; text?: string; command?: string };
  error?: { message?: string };
  message?: string;
};

export type CodexCliRun = {
  /** Resolves when the CLI completes. Rejects only when it could not run. */
  done: Promise<void>;
  /** Stop the current CLI process. Safe after completion. */
  stop: () => void;
};

export type CodexCliOptions = {
  prompt: string;
  /** `codex` means use the default selected by the signed-in CLI. */
  model?: string;
  cwd?: string | null;
  onDelta: (text: string) => void;
  onStatus?: (text: string) => void;
};

let counter = 0;

export function runCodexCli(opts: CodexCliOptions): CodexCliRun {
  const id = `husk-codex-${Date.now().toString(36)}-${(counter += 1)}`;
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    // Codex's sandbox is kept read-only. Its response may request a separate,
    // validated Husk action but never receives Husk's write, terminal, or MCP
    // capabilities.
    "--sandbox",
    "read-only",
    // A terminal can be opened outside a Git repo; that should not make this
    // provider disappear when Claude Code works there.
    "--skip-git-repo-check",
    // Husk keeps its own conversation transcript. Do not leave a second set of
    // Codex session files behind just to answer from the settings-selected mode.
    "--ephemeral",
    // Avoid loading user-configured agent tools (including MCP servers) into a
    // Husk conversation. Auth is still read by the CLI, as documented by Codex.
    "--ignore-user-config",
  ];
  if (opts.model && opts.model !== "codex") args.push("--model", opts.model);
  args.push(
    [
      "You are the signed-in Codex planner inside Husk.",
      "Do not edit files, run commands, or use external tools yourself.",
      "When the system prompt permits it, return an exact husk-action proposal; Husk validates and executes it. Never claim an action completed until Husk returns its result.",
      "",
      opts.prompt,
    ].join("\n"),
  );

  const unlisten: UnlistenFn[] = [];
  let stderr = "";
  let eventError = "";
  let sawText = false;
  let settled = false;

  const done = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      for (const fn of unlisten) fn();
      unlisten.length = 0;
    };

    void (async () => {
      try {
        unlisten.push(
          await listen<string>(`codex-cli://line/${id}`, (event) => {
            let line: CodexEvent;
            try {
              line = JSON.parse(event.payload) as CodexEvent;
            } catch {
              return;
            }

            if (line.type === "item.completed" && line.item?.type === "agent_message" && line.item.text) {
              sawText = true;
              opts.onDelta(line.item.text);
            } else if (line.type === "item.started" && line.item?.type === "command_execution") {
              // A compact status line is useful, but never expose a command as
              // if Husk itself initiated it. Codex remains sandboxed; its text
              // response, not this event, is the only accepted action input.
              opts.onStatus?.("Codex is planning");
            } else if (line.type === "turn.failed") {
              eventError = line.error?.message || "Codex could not complete this request.";
            } else if (line.type === "error") {
              eventError = line.message || "Codex reported an error.";
            }
          }),
        );
        unlisten.push(
          await listen<string>(`codex-cli://err/${id}`, (event) => {
            stderr += `${event.payload}\n`;
          }),
        );
        unlisten.push(
          await listen<number | null>(`codex-cli://exit/${id}`, (event) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (eventError) reject(new Error(eventError));
            else if (event.payload === 0 || sawText) resolve();
            else reject(new Error(stderr.trim() || `codex exited with ${event.payload ?? "no status"}`));
          }),
        );
        await invoke("codex_cli_start", { id, args, cwd: opts.cwd ?? null });
      } catch (error) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    })();
  });

  return {
    done,
    stop: () => void invoke("codex_cli_stop", { id }).catch(() => {}),
  };
}
