import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Gemini CLI as a signed-in Husk planning backend.
 *
 * Gemini's headless mode emits JSONL. Rust adds a Husk-owned deny-all policy
 * to each launch, so the CLI cannot use its filesystem, shell, extension, or
 * MCP tools even if a user's normal Gemini configuration enables them.
 */

let availability: Promise<boolean> | null = null;

export function geminiCliAvailable(refresh = false): Promise<boolean> {
  if (refresh) availability = null;
  availability ??= invoke<boolean>("gemini_cli_available").catch(() => false);
  return availability;
}

type GeminiEvent = {
  type?: string;
  role?: string;
  content?: string;
  delta?: boolean;
  response?: string;
  error?: { message?: string } | string;
  message?: string;
};

export type GeminiCliRun = {
  done: Promise<void>;
  stop: () => void;
};

export type GeminiCliOptions = {
  prompt: string;
  /** Gemini CLI's documented aliases: auto | pro | flash | flash-lite. */
  model?: string;
  cwd?: string | null;
  onDelta: (text: string) => void;
  onStatus?: (text: string) => void;
};

let counter = 0;

export function runGeminiCli(opts: GeminiCliOptions): GeminiCliRun {
  const id = `husk-gemini-${Date.now().toString(36)}-${(counter += 1)}`;
  const args = [
    "--prompt",
    [
      "You are the signed-in Gemini planner inside Husk.",
      "Husk has disabled all Gemini CLI tools for this conversation.",
      "Do not claim to have edited files, run commands, or used external tools.",
      "When the system prompt permits it, return an exact husk-action proposal; Husk validates and executes it. Never claim completion before Husk returns a result.",
      "",
      opts.prompt,
    ].join("\n"),
    "--output-format",
    "stream-json",
  ];
  // `auto` deliberately delegates model routing to the signed-in CLI.
  if (opts.model && opts.model !== "auto") args.push("--model", opts.model);

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
          await listen<string>(`gemini-cli://line/${id}`, (event) => {
            let line: GeminiEvent;
            try {
              line = JSON.parse(event.payload) as GeminiEvent;
            } catch {
              return;
            }

            // Gemini's stream-json contract emits assistant text as message
            // events. Keep the result response only as a fallback because it
            // can contain the complete answer a second time.
            if (line.type === "message" && line.role === "assistant" && line.content) {
              sawText = true;
              opts.onDelta(line.content);
            } else if (line.type === "result" && !sawText && line.response) {
              sawText = true;
              opts.onDelta(line.response);
            } else if (line.type === "error") {
              eventError = typeof line.error === "string"
                ? line.error
                : line.error?.message || line.message || "Gemini reported an error.";
            }
          }),
        );
        unlisten.push(
          await listen<string>(`gemini-cli://err/${id}`, (event) => {
            stderr += `${event.payload}\n`;
          }),
        );
        unlisten.push(
          await listen<number | null>(`gemini-cli://exit/${id}`, (event) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (eventError) reject(new Error(eventError));
            else if (event.payload === 0 || sawText) resolve();
            else reject(new Error(stderr.trim() || `gemini exited with ${event.payload ?? "no status"}`));
          }),
        );
        await invoke("gemini_cli_start", { id, args, cwd: opts.cwd ?? null });
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
    stop: () => void invoke("gemini_cli_stop", { id }).catch(() => {}),
  };
}
