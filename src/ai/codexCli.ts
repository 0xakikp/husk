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

/** Build the fixed, response-only Codex invocation. Rust adds a final
 * Husk-owned deny-all PreToolUse hook before launch; these switches remove the
 * known tool families at their source, while the hook is defence in depth. */
export function buildCodexCliArgs(prompt: string, model?: string): string[] {
  const args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    // Never inherit local tools, MCP servers, apps, rules, or agents from the
    // user's normal Codex setup into a Husk subscription conversation.
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--disable",
    "shell_tool",
    "--disable",
    "unified_exec",
    "--disable",
    "apps",
    "--disable",
    "remote_plugin",
    "--disable",
    "multi_agent",
    "--disable",
    "goals",
    "--config",
    "agents.enabled=false",
    "--config",
    "apps._default.enabled=false",
    "--config",
    'web_search="disabled"',
  ];
  if (model && model !== "codex") args.push("--model", model);
  args.push(
    [
      "You are the signed-in Codex planner inside Husk.",
      "No Codex tools are available in this conversation.",
      "Do not edit files, run commands, browse, or call connected services yourself.",
      "When the system prompt permits it, return an exact husk-action proposal; Husk validates and executes it. Never claim an action completed until Husk returns its result.",
      "",
      prompt,
    ].join("\n"),
  );
  return args;
}

export function runCodexCli(opts: CodexCliOptions): CodexCliRun {
  const id = `husk-codex-${Date.now().toString(36)}-${(counter += 1)}`;
  const args = buildCodexCliArgs(opts.prompt, opts.model);

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
            } else if (
              line.type === "item.started" &&
              ["command_execution", "file_change", "mcp_tool_call", "web_search"].includes(line.item?.type ?? "")
            ) {
              /* This should be unreachable because launch disables tool
                 families and Rust installs a deny-all hook. Fail closed if a
                 future CLI introduces a path that slips through both. */
              eventError = `Codex attempted a blocked ${line.item?.type?.replace(/_/g, " ") ?? "tool"} action.`;
              void invoke("codex_cli_stop", { id }).catch(() => {});
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
