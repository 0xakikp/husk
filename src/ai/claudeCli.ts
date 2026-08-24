import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * The `claude` CLI as an AI backend.
 *
 * For anyone already paying for a Claude subscription, pasting an API key means
 * paying twice for the same model. This runs the CLI they are already logged into
 * instead, so there is no key in Husk at all — nothing to store, leak or sync.
 *
 * Husk asks the CLI to do the work rather than reading its keychain entry and
 * calling the API as if it were Claude Code. See src-tauri/src/ai_cli.rs for why.
 */

/** Cached between checks, but refreshable after an install or PATH change. */
let availability: Promise<boolean> | null = null;

export function claudeCliAvailable(refresh = false): Promise<boolean> {
  if (refresh) availability = null;
  availability ??= invoke<boolean>("ai_cli_available").catch(() => false);
  return availability;
}

/**
 * One line of `--output-format stream-json`.
 *
 * Only the shapes we act on are described. The CLI emits more (rate limits,
 * cost), and unknown types are ignored rather than treated as errors — a newer
 * CLI adding an event must not break an older Husk.
 */
type StreamLine =
  | { type: "system"; subtype?: string; session_id?: string }
  | { type: "assistant"; message?: { content?: { type: string; text?: string; name?: string }[] } }
  | { type: "result"; session_id?: string; result?: string; is_error?: boolean }
  | {
      type: "rate_limit_event";
      rate_limit_info?: {
        status?: string;
        rateLimitType?: string;
        overageStatus?: string;
        isUsingOverage?: boolean;
      };
    }
  | { type: string };

export type ClaudeCliRun = {
  /** Resolves when the CLI exits. Rejects only if it could not be started. */
  done: Promise<void>;
  /** Kill it. Safe to call after it has already finished. */
  stop: () => void;
};

export type ClaudeCliOptions = {
  prompt: string;
  /** opus | sonnet | haiku. Anything else is left to the CLI's default. */
  model?: string;
  /** @deprecated Husk resends its transcript and does not resume CLI state. */
  sessionId?: string;
  cwd?: string | null;
  onDelta: (text: string) => void;
  /** Tool activity, for the composer's status line. */
  onStatus?: (text: string) => void;
  /** @deprecated Kept for source compatibility; CLI sessions are disposable. */
  onSession?: (id: string) => void;
  /** Plan/quota notices worth showing the user, not tool chatter. */
  onNotice?: (text: string) => void;
};

let counter = 0;

/** Build a Claude invocation with no built-in, plugin, or MCP tools. */
export function buildClaudeCliArgs(prompt: string, model?: string): string[] {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    // stream-json requires verbose; without it the CLI refuses to start, and the
    // error arrives on stderr where it is easy to miss.
    "--verbose",
    // Empty allowlists are future-proof: a newly added Claude tool remains off.
    "--tools",
    "",
    // Do not inherit project/user settings, plugins, slash commands, browser
    // automation, or MCP servers into Husk's response-only backend.
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--no-chrome",
    // Husk owns the only transcript. Avoid a second hidden session store.
    "--no-session-persistence",
  ];
  if (model && ["opus", "sonnet", "haiku"].includes(model)) {
    args.push("--model", model);
  }
  return args;
}

export function runClaudeCli(opts: ClaudeCliOptions): ClaudeCliRun {
  const id = `husk-${Date.now().toString(36)}-${(counter += 1)}`;
  const args = buildClaudeCliArgs(opts.prompt, opts.model);

  const unlisten: UnlistenFn[] = [];
  let stderr = "";
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
          await listen<string>(`ai-cli://line/${id}`, (e) => {
            let line: StreamLine;
            try {
              line = JSON.parse(e.payload) as StreamLine;
            } catch {
              return; // not JSON: a banner or progress note, not ours to render
            }

            if (line.type === "system" && "session_id" in line && line.session_id) {
              opts.onSession?.(line.session_id);
            } else if (line.type === "assistant" && "message" in line) {
              for (const block of line.message?.content ?? []) {
                if (block.type === "text" && block.text) {
                  sawText = true;
                  opts.onDelta(block.text);
                } else if (block.type === "tool_use" && block.name) {
                  opts.onStatus?.(block.name);
                }
              }
            } else if (line.type === "rate_limit_event" && "rate_limit_info" in line) {
              /* Observed in a real run: the CLI reports plan limits mid-stream.
                 Without surfacing it, hitting a weekly cap looks like the model
                 being slow or the request quietly failing — the user has no way
                 to tell a quota problem from a bug. */
              const info = line.rate_limit_info ?? {};
              if (info.status === "rejected") {
                opts.onNotice?.(
                  `Claude plan limit reached${info.rateLimitType ? ` (${info.rateLimitType.replace(/_/g, " ")})` : ""}` +
                    (info.isUsingOverage ? " — running on overage" : ""),
                );
              } else if (info.isUsingOverage) {
                opts.onNotice?.("Running on Claude plan overage");
              }
            } else if (line.type === "result") {
              if ("session_id" in line && line.session_id) opts.onSession?.(line.session_id);
              /* The CLI can finish with its answer only in `result` and never as
                 an assistant block — a short reply, or one served from cache.
                 Emitting it when nothing streamed avoids an empty bubble; doing
                 it unconditionally would duplicate the whole answer. */
              if (!sawText && "result" in line && line.result) opts.onDelta(line.result);
            }
          }),
        );

        unlisten.push(
          await listen<string>(`ai-cli://err/${id}`, (e) => {
            stderr += `${e.payload}\n`;
          }),
        );

        unlisten.push(
          await listen<number | null>(`ai-cli://exit/${id}`, (e) => {
            if (settled) return;
            settled = true;
            cleanup();
            const code = e.payload;
            if (code === 0 || sawText) resolve();
            else reject(new Error(stderr.trim() || `claude exited with ${code ?? "no status"}`));
          }),
        );

        await invoke("ai_cli_start", { id, args, cwd: opts.cwd ?? null });
      } catch (e) {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });

  return {
    done,
    stop: () => void invoke("ai_cli_stop", { id }).catch(() => {}),
  };
}
