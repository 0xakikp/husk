import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * Kimi Code as a signed-in Husk planning backend.
 *
 * Kimi's non-interactive mode normally auto-approves its own tools. The Rust
 * bridge therefore supplies a one-run Kimi agent profile with `tools: []`.
 * Kimi enforces that allowlist before a tool can execute; this is a boundary,
 * not a best-effort instruction in the prompt.
 */

let availability: Promise<boolean> | null = null;

export function kimiCliAvailable(refresh = false): Promise<boolean> {
  if (refresh) availability = null;
  availability ??= invoke<boolean>("kimi_cli_available").catch(() => false);
  return availability;
}

type KimiContent = string | { text?: string }[] | { text?: string } | undefined;
type KimiEvent = {
  type?: string;
  role?: string;
  content?: KimiContent;
  text?: string;
  message?: { role?: string; content?: KimiContent; text?: string } | string;
  error?: { message?: string } | string;
};

function textFrom(content: KimiContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text || "").join("");
  return content?.text || "";
}

export type KimiCliRun = {
  done: Promise<void>;
  stop: () => void;
};

export type KimiCliOptions = {
  prompt: string;
  /** `kimi` means use the default model in the signed-in Kimi CLI. */
  model?: string;
  cwd?: string | null;
  onDelta: (text: string) => void;
};

let counter = 0;

export function runKimiCli(opts: KimiCliOptions): KimiCliRun {
  const id = `husk-kimi-${Date.now().toString(36)}-${(counter += 1)}`;
  const args = [
    "--prompt",
    [
      "You are the signed-in Kimi planner inside Husk.",
      "No Kimi Code tools are available in this conversation.",
      "Do not claim to have edited files, run commands, or used external tools.",
      "When the system prompt permits it, return an exact husk-action proposal; Husk validates and executes it. Never claim completion before Husk returns a result.",
      "",
      opts.prompt,
    ].join("\n"),
    "--output-format",
    "stream-json",
  ];
  if (opts.model && opts.model !== "kimi") args.push("--model", opts.model);

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
          await listen<string>(`kimi-cli://line/${id}`, (event) => {
            let line: KimiEvent;
            try {
              line = JSON.parse(event.payload) as KimiEvent;
            } catch {
              return;
            }

            const message = typeof line.message === "object" ? line.message : undefined;
            const role = line.role || message?.role;
            const isAssistant = role === "assistant" || line.type === "assistant";
            const text = textFrom(line.content) || textFrom(message?.content) || (isAssistant ? line.text || message?.text || "" : "");
            if (isAssistant && text) {
              sawText = true;
              opts.onDelta(text);
            } else if (line.type === "error") {
              eventError = typeof line.error === "string"
                ? line.error
                : line.error?.message || "Kimi Code reported an error.";
            }
          }),
        );
        unlisten.push(
          await listen<string>(`kimi-cli://err/${id}`, (event) => {
            stderr += `${event.payload}\n`;
          }),
        );
        unlisten.push(
          await listen<number | null>(`kimi-cli://exit/${id}`, (event) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (eventError) reject(new Error(eventError));
            else if (event.payload === 0 || sawText) resolve();
            else reject(new Error(stderr.trim() || `kimi exited with ${event.payload ?? "no status"}`));
          }),
        );
        await invoke("kimi_cli_start", { id, args, cwd: opts.cwd ?? null });
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
    stop: () => void invoke("kimi_cli_stop", { id }).catch(() => {}),
  };
}
