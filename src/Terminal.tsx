import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { setActiveTerminalReader } from "./ai/terminalContext";
import "@xterm/xterm/css/xterm.css";

/** A single xterm.js terminal backed by a Rust PTY session. */
export function TerminalView({ active = true }: { active?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

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
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(container);
    fit.fit();
    termRef.current = term;
    searchRef.current = search;

    // Cmd/Ctrl+F opens find-in-terminal.
    term.attachCustomKeyEventHandler((e) => {
      if (
        e.type === "keydown" &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "f"
      ) {
        setSearchOpen(true);
        return false;
      }
      return true;
    });

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
      termRef.current = null;
      searchRef.current = null;
      term.dispose();
    };
  }, []);

  // While this is the active tab, expose its recent output to the AI panel.
  useEffect(() => {
    if (!active) return;
    setActiveTerminalReader(() => {
      const term = termRef.current;
      if (!term) return "";
      const buf = term.buffer.active;
      const lines: string[] = [];
      const start = Math.max(0, buf.length - 60);
      for (let i = start; i < buf.length; i += 1) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      }
      return lines.join("\n").replace(/\n+$/, "");
    });
    return () => setActiveTerminalReader(null);
  }, [active]);

  const closeSearch = () => {
    setSearchOpen(false);
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  return (
    <div className="terminal-host-wrap">
      <div ref={containerRef} className="terminal-host" />
      {searchOpen ? (
        <div className="term-search">
          <input
            autoFocus
            value={query}
            placeholder="Find in terminal…"
            onChange={(e) => {
              setQuery(e.target.value);
              searchRef.current?.findNext(e.target.value, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (query) {
                  if (e.shiftKey) searchRef.current?.findPrevious(query);
                  else searchRef.current?.findNext(query);
                }
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeSearch();
              }
            }}
          />
          <button
            type="button"
            className="term-search-close"
            aria-label="Close search"
            onClick={closeSearch}
          >
            ×
          </button>
        </div>
      ) : null}
    </div>
  );
}
