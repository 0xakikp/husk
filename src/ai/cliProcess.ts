import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function abortError(): Error {
  return new DOMException("Request stopped.", "AbortError");
}

export type CliProcess = { done: Promise<void>; stop: () => void };

/** All subscription providers share the same cancellation and IPC lifetime. */
export function runCliProcess(options: {
  id: string;
  prefix: string;
  command: string;
  args: string[];
  cwd?: string | null;
  onLine: (line: string) => void;
  error: () => string;
}): CliProcess {
  const { id, prefix, command } = options;
  const unlisten: UnlistenFn[] = [];
  let settled = false;
  let stopped = false;
  let starting = false;
  let stderr = "";
  let finish!: (error?: unknown) => void;
  const kill = () => void invoke(`${command}_stop`, { id }).catch(() => {});
  const done = new Promise<void>((resolve, reject) => {
    finish = (error) => {
      if (settled) return;
      settled = true;
      for (const remove of unlisten.splice(0)) remove();
      if (error) reject(error instanceof Error ? error : new Error(String(error)));
      else resolve();
    };
  });
  const register = async <T>(event: string, handler: (payload: T) => void) => {
    const remove = await listen<T>(`${prefix}://${event}/${id}`, ({ payload }) => {
      if (!settled) handler(payload);
    });
    // Stop can happen while listener registration is awaiting IPC.
    if (settled) remove();
    else unlisten.push(remove);
  };
  void (async () => {
    try {
      await register<string>("line", (line) => {
        try { options.onLine(line); } catch (error) { kill(); finish(error); }
      });
      if (settled) return;
      await register<string>("err", (line) => { stderr += `${line}\n`; });
      if (settled) return;
      await register<number | null>("exit", (code) => {
        const error = options.error();
        finish(error || (code === 0 ? undefined : stderr.trim() || `${prefix} exited with ${code ?? "no status"}`));
      });
      if (settled) return;
      starting = true;
      await invoke(`${command}_start`, { id, args: options.args, cwd: options.cwd ?? null });
      // The first Stop may have reached Rust before its spawn was registered.
      if (stopped) kill();
    } catch (error) {
      finish(stopped ? abortError() : error);
    }
  })();
  return {
    done,
    stop: () => {
      if (settled) return;
      stopped = true;
      finish(abortError());
      if (starting) kill();
    },
  };
}
