import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

/** A single xterm.js terminal backed by a Rust PTY session. */
export function TerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily:
        '"JetBrains Mono", "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: "#0b0d12",
        foreground: "#d4d7dd",
        cursor: "#d4d7dd",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    let ptyId: number | null = null;
    let disposed = false;
    const unlisteners: UnlistenFn[] = [];

    void (async () => {
      const id = await invoke<number>("pty_spawn", {
        cols: term.cols,
        rows: term.rows,
      });
      // Effect was torn down before spawn resolved (e.g. StrictMode remount).
      if (disposed) {
        void invoke("pty_kill", { id });
        return;
      }
      ptyId = id;

      unlisteners.push(
        await listen<number[]>(`pty://data/${id}`, (e) => {
          term.write(new Uint8Array(e.payload));
        }),
      );
      unlisteners.push(
        await listen(`pty://exit/${id}`, () => {
          term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
        }),
      );

      term.onData((data) => void invoke("pty_write", { id, data }));
      term.onResize(({ cols, rows }) =>
        void invoke("pty_resize", { id, cols, rows }),
      );
    })();

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // container not measurable (hidden) — ignore
      }
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      for (const un of unlisteners) un();
      if (ptyId !== null) void invoke("pty_kill", { id: ptyId });
      term.dispose();
    };
  }, []);

  return <div ref={containerRef} className="terminal-host" />;
}
