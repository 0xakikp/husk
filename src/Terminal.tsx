import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  setActiveTerminalReader,
  setActiveTerminalRunner,
  setActiveTerminalTyper,
  setActiveTerminalSearchOpener,
  setActiveTerminalSearcher,
  setActiveTerminalCwd,
  setActiveTerminalExit,
  setTerminalTyping,
  setCurrentCommand,
  clearCurrentCommand,
  markCommandStart,
  setPromptPosition,
  getPromptPosition,
  isCommandRunning,
} from "./ai/terminalContext";
import {
  interceptTerminalInput,
  setTerminalLineReader,
  setAiPtyWriter,
} from "./ai/terminalInput";
import { setFocusTerminalFn } from "./ai/terminalContext";
import { getPrefs, subscribePrefs } from "./settings/preferences";
import { buildTerminalTheme } from "./styles/terminalTheme";
import { fontStack } from "./styles/fonts";
import { getShellHistory } from "./shellHistory";
import { TerminalHistoryPanel } from "./TerminalHistory";
import { parseBridgeOsc, dispatchBridge } from "./bridge";
import { useAutocomplete } from "./terminal/useAutocomplete";
import { AutocompleteBar } from "./terminal/AutocompleteBar";
import "@xterm/xterm/css/xterm.css";

/**
 * Parse the path out of an OSC 7 payload: `file://<host>/<url-encoded-path>`.
 * Returns the decoded absolute path, or null if it isn't a usable file URI.
 */
function parseOsc7Cwd(data: string): string | null {
  if (!data.startsWith("file://")) return null;
  const afterScheme = data.slice("file://".length);
  const slash = afterScheme.indexOf("/");
  if (slash < 0) return null;
  const encodedPath = afterScheme.slice(slash);
  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
}

/** A single xterm.js terminal backed by a Rust PTY session. */
export function TerminalView({
  active = true,
  initialCwd,
  onSplit,
  onClose,
  canClose = false,
  onFocus,
  onFocusDirection,
}: {
  active?: boolean;
  initialCwd?: string;
  onSplit?: (dir: "row" | "col") => void;
  onClose?: () => void;
  canClose?: boolean;
  onFocus?: () => void;
  onFocusDirection?: (dir: "left" | "right" | "up" | "down") => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const ptyIdRef = useRef<number | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Tracks the latest `active` so the OSC handlers (set up once at mount) know
  // whether this terminal is the foreground one; `cwdRef` holds its last cwd.
  const activeRef = useRef(active);
  const cwdRef = useRef("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLElement | null>(null);

  // ── Autocomplete ─────────────────────────────────────────────────────────
  const {
    state: autoState,
    stateRef: autoStateRef,
    scheduleCheck: scheduleAutoCheck,
    accept: acceptAuto,
    navigate: navigateAuto,
    dismiss: dismissAuto,
  } = useAutocomplete(termRef, ptyIdRef);

  const acceptAutoRef = useRef(acceptAuto);
  const navigateAutoRef = useRef(navigateAuto);
  const dismissAutoRef = useRef(dismissAuto);
  useEffect(() => {
    acceptAutoRef.current = acceptAuto;
    navigateAutoRef.current = navigateAuto;
    dismissAutoRef.current = dismissAuto;
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      fontFamily: fontStack(getPrefs().fontFamily),
      fontSize: getPrefs().terminalFontSize,
      cursorBlink: getPrefs().cursorBlink,
      cursorStyle: getPrefs().terminalCursorStyle,
      scrollback: getPrefs().terminalScrollback,
      allowProposedApi: true,
      allowTransparency: true,
      theme: buildTerminalTheme(
        getPrefs().terminalTheme,
        getPrefs().theme === "dark",
        getPrefs().background.enabled,
        getPrefs().accentColor,
      ),
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(container);
    fit.fit();
    screenRef.current = container.querySelector(".xterm-screen") as HTMLElement | null;
    termRef.current = term;
    searchRef.current = search;
    fitRef.current = fit;

    // Shell-integration escape sequences emitted by our injected rc scripts:
    // OSC 7 reports the working directory; OSC 133;D carries the last command's
    // exit code. We consume them (return true) so they never render as text.
    term.parser.registerOscHandler(7, (data) => {
      const cwd = parseOsc7Cwd(data);
      if (cwd) {
        cwdRef.current = cwd;
        if (activeRef.current) setActiveTerminalCwd(cwd);
      }
      return true;
    });
    term.parser.registerOscHandler(133, (data) => {
      if (data.startsWith("D") && activeRef.current) {
        const code = Number.parseInt(data.split(";")[1] ?? "", 10);
        setActiveTerminalExit(Number.isNaN(code) ? null : code);
        clearCurrentCommand(); // command finished
      }
      if (data.startsWith("C") && activeRef.current) {
        markCommandStart(); // command started (preexec)
      }
      if (data.startsWith("B") && activeRef.current) {
        // Prompt finished rendering — capture cursor position as prompt start
        const buf = term.buffer.active;
        setPromptPosition({ row: buf.cursorY + buf.viewportY, col: buf.cursorX });
      }
      if (data.startsWith("A") && activeRef.current) {
        // Prompt about to start — clear old position
        setPromptPosition(null);
      }
      return true;
    });
    // OSC 778 — shell preexec reports the command text (zsh preexec hook)
    term.parser.registerOscHandler(778, (data) => {
      if (data.startsWith("husk;cmd;") && activeRef.current) {
        const cmd = data.slice("husk;cmd;".length).replace(/%3B/g, ";");
        setCurrentCommand(cmd.trim());
      }
      return true;
    });
    // OSC 777 — the `husk` shell command bridges terminal → GUI
    // (open / preview / notify / diff).
    term.parser.registerOscHandler(777, (data) => {
      const cmd = parseBridgeOsc(data);
      if (cmd) dispatchBridge(cmd);
      return true;
    });

    // Cmd/Ctrl+F opens find-in-terminal; Ctrl+R opens the history picker
    // (intercepted before the shell's own reverse-i-search).
    term.attachCustomKeyEventHandler((e) => {
      if (
        e.type === "keydown" &&
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === "f"
      ) {
        setSearchOpen(true);
        return false;
      }
      if (e.type === "keydown" && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") {
        setHistoryOpen(true);
        setHistoryLoading(true);
        void getShellHistory()
          .then((rows) => setHistoryEntries(rows.map((r) => r.command)))
          .catch(() => setHistoryEntries([]))
          .finally(() => setHistoryLoading(false));
        return false;
      }
      // Cmd+C / Ctrl+C — copy selection to clipboard
      if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && term.hasSelection()) {
        const sel = term.getSelection();
        if (sel) void writeText(sel);
        return false;
      }
      // Cmd+V / Ctrl+V — paste from clipboard
      if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        void readText().then((t) => {
          if (t && ptyIdRef.current != null) void invoke("pty_write", { id: ptyIdRef.current, data: t });
        });
        return false;
      }
      // Cmd+D splits right, Cmd+Shift+D splits down. Meta-only (macOS) so we
      // never clash with Ctrl+D (EOF) on Linux/Windows.
      if (e.type === "keydown" && e.metaKey && e.key.toLowerCase() === "d") {
        onSplit?.(e.shiftKey ? "col" : "row");
        return false;
      }
      // Cmd+Alt+Arrow navigates focus between panes (Hyprland-style)
      if (e.type === "keydown" && e.metaKey && e.altKey) {
        const dirMap: Record<string, "left" | "right" | "up" | "down" | undefined> = {
          ArrowLeft: "left",
          ArrowRight: "right",
          ArrowUp: "up",
          ArrowDown: "down",
        };
        const dir = dirMap[e.key];
        if (dir) {
          onFocusDirection?.(dir);
          return false;
        }
      }
      // Autocomplete navigation
      if (e.type === "keydown" && autoStateRef.current.visible) {
        if (e.key === "Tab") {
          e.preventDefault();
          acceptAutoRef.current();
          return false;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          navigateAutoRef.current(1);
          return false;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          navigateAutoRef.current(-1);
          return false;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          dismissAutoRef.current();
          return false;
        }
      }
      return true;
    });

    let ptyId: number | null = null;
    let disposed = false;
    let resizeTimer = 0;
    let lastCols = -1;
    let lastRows = -1;
    const unlisteners: UnlistenFn[] = [];

    void (async () => {
      const id = await invoke<number>("pty_spawn", {
        cols: term.cols,
        rows: term.rows,
        cwd: initialCwd ?? null,
      });
      // Effect was torn down before spawn resolved (e.g. StrictMode remount).
      if (disposed) {
        void invoke("pty_kill", { id });
        return;
      }
      ptyId = id;
      ptyIdRef.current = id;

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

      let typingTimer = 0;
      term.onData((data) => {
        const out = interceptTerminalInput(data);
        if (out === null) return; // swallowed by /ai interceptor
        void invoke("pty_write", { id, data: out });
        setTerminalTyping(true);
        window.clearTimeout(typingTimer);
        typingTimer = window.setTimeout(() => setTerminalTyping(false), 400);
        scheduleAutoCheck();
      });
      // Fit is debounced (below), so this fires once when a resize settles —
      // send that single final size to the PTY (one SIGWINCH, one prompt
      // redraw), and only when it actually changed (dedupe).
      term.onResize(({ cols, rows }) => {
        if (cols === lastCols && rows === lastRows) return;
        lastCols = cols;
        lastRows = rows;
        void invoke("pty_resize", { id, cols, rows });
      });
    })();

    const doFit = () => {
      const t = termRef.current;
      // Skip while hidden/zero-sized (e.g. an inactive tab): fitting then would
      // shrink the terminal out of sync with the shell. The observer re-fires
      // when the pane is shown again.
      if (!t || !container.clientWidth || !container.clientHeight) return;
      try {
        fit.fit();
        t.scrollToBottom();
      } catch {
        // not measurable
      }
    };
    // Snap-on-settle: don't resize mid-drag. Fit once ~150ms after the last
    // size change so there's a single resize, not one per drag frame.
    // maxWait=500 guarantees a fit even during continuous resize (e.g. drag).
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(doFit, 150);
    });
    // Safety: force-fit at least every 500ms during continuous resize, but only
    // if a resize is actually pending (resizeTimer is set). Reset the timer so
    // we don't fit again until the observer schedules another one.
    const maxWaitTimer = window.setInterval(() => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
        resizeTimer = 0;
        doFit();
      }
    }, 500);
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      clearInterval(maxWaitTimer);
      resizeObserver.disconnect();
      for (const un of unlisteners) un();
      if (ptyId !== null) void invoke("pty_kill", { id: ptyId });
      ptyIdRef.current = null;
      termRef.current = null;
      searchRef.current = null;
      fitRef.current = null;
      term.dispose();
    };
  }, []);

  // While this is the active tab, expose its recent output to the AI panel.
  useEffect(() => {
    activeRef.current = active;
    if (active) {
      // Auto-focus the terminal when it becomes the active tab / pane
      termRef.current?.focus();
      setFocusTerminalFn(() => termRef.current?.focus());
    } else {
      setFocusTerminalFn(null);
      return;
    }
    // The moment this terminal becomes active, surface its last-known cwd so a
    // newly-opened tab inherits the right directory.
    if (cwdRef.current) setActiveTerminalCwd(cwdRef.current);
    setActiveTerminalReader(() => {
      const term = termRef.current;
      if (!term) return "";
      const buf = term.buffer.active;
      const lines: string[] = [];
      let chars = 0;
      // Build from the bottom up until we hit the 8KB cap, then reverse so the
      // LLM sees chronological order.
      const maxChars = 8192;
      for (let i = buf.length - 1; i >= 0; i -= 1) {
        const line = buf.getLine(i)?.translateToString(true) ?? "";
        if (chars + line.length + 1 > maxChars && lines.length > 0) break;
        lines.push(line);
        chars += line.length + 1;
      }
      return lines.reverse().join("\n").replace(/\n+$/, "");
    });
    setActiveTerminalRunner((cmd) => {
      const id = ptyIdRef.current;
      if (id != null) void invoke("pty_write", { id, data: `${cmd}\r` });
      termRef.current?.focus();
    });
    setActiveTerminalTyper((text) => {
      const id = ptyIdRef.current;
      if (id != null) void invoke("pty_write", { id, data: text });
      termRef.current?.focus();
    });
    setActiveTerminalSearchOpener(() => setSearchOpen(true));
    setActiveTerminalSearcher((q: string) => {
      setSearchOpen(true);
      setQuery(q);
    });

    // AI /ai command interception — line reader + PTY writer
    setTerminalLineReader(() => {
      const term = termRef.current;
      if (!term) return "";
      const buf = term.buffer.active;
      const line = buf.getLine(buf.cursorY)?.translateToString(true) ?? "";
      return line;
    });
    setAiPtyWriter((data) => {
      const id = ptyIdRef.current;
      if (id != null) void invoke("pty_write", { id, data });
    });

    return () => {
      setActiveTerminalReader(null);
      setActiveTerminalRunner(null);
      setActiveTerminalTyper(null);
      setActiveTerminalSearchOpener(null);
      setActiveTerminalSearcher(null);
      setTerminalLineReader(null);
      setAiPtyWriter(null);
      setFocusTerminalFn(null);
    };
  }, [active]);

  // Apply preference changes (font size, cursor blink, theme, zoom) to the live
  // terminal. The refit is debounced so webview zoom finishes applying before we
  // measure — measuring mid-zoom yields wrong columns and desyncs the shell
  // (which is what stacks the prompt).
  useEffect(() => {
    let t = 0;
    const unsub = subscribePrefs(() => {
      const term = termRef.current;
      if (!term) return;
      const p = getPrefs();
      term.options.fontSize = p.terminalFontSize;
      term.options.fontFamily = fontStack(p.fontFamily);
      term.options.cursorBlink = p.cursorBlink;
      term.options.cursorStyle = p.terminalCursorStyle;
      term.options.scrollback = p.terminalScrollback;
      term.options.theme = buildTerminalTheme(
        p.terminalTheme,
        p.theme === "dark",
        p.background.enabled,
        p.accentColor,
      );
      clearTimeout(t);
      t = window.setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {
          // ignore
        }
      }, 90);
    });
    return () => {
      unsub();
      clearTimeout(t);
    };
  }, []);

  const closeSearch = () => {
    setSearchOpen(false);
    setQuery("");
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  };

  // Execute search whenever query changes (driven by header search bar or inline input).
  useEffect(() => {
    if (!searchOpen || !query) return;
    searchRef.current?.findNext(query, { incremental: true });
  }, [query, searchOpen]);

  const selectHistory = (command: string) => {
    const id = ptyIdRef.current;
    // Drop the command at the prompt (no newline) so the user can edit/run it.
    if (id != null) void invoke("pty_write", { id, data: command });
    setHistoryOpen(false);
    termRef.current?.focus();
  };

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    void getShellHistory()
      .then((rows) => setHistoryEntries(rows.map((r) => r.command)))
      .catch(() => setHistoryEntries([]))
      .finally(() => setHistoryLoading(false));
  };

  const menuCopy = () => {
    setMenu(null);
    const sel = termRef.current?.getSelection();
    if (sel) void writeText(sel);
    termRef.current?.clearSelection();
  };
  const menuPaste = () => {
    setMenu(null);
    void readText()
      .then((t) => {
        const id = ptyIdRef.current;
        if (t && id != null) void invoke("pty_write", { id, data: t });
        termRef.current?.focus();
      })
      .catch(() => {});
  };

  const handleTerminalClick = (e: React.MouseEvent) => {
    const term = termRef.current;
    const id = ptyIdRef.current;
    if (!term || id == null) return;
    if (isCommandRunning()) return;
    if (term.hasSelection()) {
      term.clearSelection();
    }

    const buf = term.buffer.active;
    if (buf.type !== "normal") return;

    const prompt = getPromptPosition();
    if (!prompt) return;

    const screenEl = screenRef.current;
    if (!screenEl) return;
    const screenRect = screenEl.getBoundingClientRect();
    const style = window.getComputedStyle(screenEl);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const contentW = screenRect.width - padL - padR;
    const cellW = contentW / term.cols;
    const cellH = screenRect.height / term.rows;
    if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW <= 0 || cellH <= 0) return;

    const x = e.clientX - screenRect.left - padL;
    const y = e.clientY - screenRect.top;

    const col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH) + buf.viewportY;

    const curCol = buf.cursorX;
    const curRow = buf.cursorY + buf.viewportY;

    if (row < prompt.row || row > curRow) return;
    if (row === prompt.row && col < prompt.col) return;
    if (col < 0 || col >= term.cols) return;

    const rowDelta = row - curRow;
    const colDelta = col - curCol;

    const arrows: string[] = [];
    for (let i = 0; i < Math.abs(rowDelta); i++) {
      arrows.push(rowDelta < 0 ? "\x1b[A" : "\x1b[B");
    }
    for (let i = 0; i < Math.abs(colDelta); i++) {
      arrows.push(colDelta < 0 ? "\x1b[D" : "\x1b[C");
    }
    const seq = arrows.join("");
    if (seq) {
      invoke("pty_write", { id, data: seq }).catch((err: unknown) => {
        console.error("[click-to-edit] pty_write failed:", err);
      });
    }
  };

  const handleTerminalMouseMove = (e: React.MouseEvent) => {
    const term = termRef.current;
    const host = hostRef.current;
    if (!term || !host) {
      host && (host.style.cursor = "");
      return;
    }
    if (isCommandRunning() || term.hasSelection()) {
      host.style.cursor = "";
      return;
    }

    const buf = term.buffer.active;
    if (buf.type !== "normal") {
      host.style.cursor = "";
      return;
    }

    const prompt = getPromptPosition();
    if (!prompt) {
      host.style.cursor = "";
      return;
    }

    const screenEl = screenRef.current;
    if (!screenEl) {
      host.style.cursor = "";
      return;
    }
    const screenRect = screenEl.getBoundingClientRect();
    const style = window.getComputedStyle(screenEl);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const contentW = screenRect.width - padL - padR;
    const cellW = contentW / term.cols;
    const cellH = screenRect.height / term.rows;
    if (!Number.isFinite(cellW) || !Number.isFinite(cellH) || cellW <= 0 || cellH <= 0) {
      host.style.cursor = "";
      return;
    }

    const x = e.clientX - screenRect.left - padL;
    const y = e.clientY - screenRect.top;

    const col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH) + buf.viewportY;

    const curRow = buf.cursorY + buf.viewportY;

    const inCommandArea =
      row >= prompt.row &&
      row <= curRow &&
      !(row === prompt.row && col < prompt.col) &&
      col >= 0 &&
      col < term.cols;

    host.style.cursor = inCommandArea ? "text" : "";
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    // Clamp menu position to viewport so it never renders off-screen
    const MENU_W = 168;
    const MENU_H = 220; // approximate max height
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8);
    setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  };

  return (
    <div
      ref={hostRef}
      className="terminal-host-wrap"
      onMouseDown={() => {
        onFocus?.();
        termRef.current?.focus();
        dismissAuto();
      }}
      onClick={handleTerminalClick}
      onMouseMove={handleTerminalMouseMove}
      onMouseLeave={() => {
        const host = hostRef.current;
        if (host) host.style.cursor = "";
      }}
      onContextMenu={handleContextMenu}
    >
      <div ref={containerRef} className="terminal-host" />
      <AutocompleteBar
        visible={autoState.visible}
        suggestions={autoState.suggestions}
        selectedIndex={autoState.selectedIndex}
        position={autoState.position}
        onSelect={(i) => acceptAuto(i)}
      />
      {searchOpen ? (
        <div className="term-search">
          <input
            autoFocus
            value={query}
            placeholder="Find in terminal…"
            onChange={(e) => setQuery(e.target.value)}
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
      {historyOpen ? (
        <TerminalHistoryPanel
          entries={historyEntries}
          loading={historyLoading}
          onSelect={selectHistory}
          onClose={() => {
            setHistoryOpen(false);
            termRef.current?.focus();
          }}
        />
      ) : null}
      {menu ? (
        <>
          <div
            className="ectx-backdrop"
            onClick={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="ectx-menu" style={{ top: menu.y, left: menu.x }} role="menu">
            <button type="button" className="ectx-item" onClick={menuCopy}>
              Copy
            </button>
            <button type="button" className="ectx-item" onClick={menuPaste}>
              Paste
            </button>
            <button type="button" className="ectx-item" onClick={() => { setMenu(null); termRef.current?.selectAll(); }}>
              Select all
            </button>
            <button type="button" className="ectx-item" onClick={() => { setMenu(null); termRef.current?.clear(); termRef.current?.focus(); }}>
              Clear
            </button>
            <button type="button" className="ectx-item" onClick={() => { setMenu(null); setSearchOpen(true); }}>
              Find…
            </button>
            <button type="button" className="ectx-item" onClick={() => { setMenu(null); openHistory(); }}>
              History…
            </button>
            {onSplit ? (
              <>
                <button type="button" className="ectx-item" onClick={() => { setMenu(null); onSplit("row"); }}>
                  Split right
                </button>
                <button type="button" className="ectx-item" onClick={() => { setMenu(null); onSplit("col"); }}>
                  Split down
                </button>
              </>
            ) : null}
            {onClose && canClose ? (
              <button type="button" className="ectx-item" onClick={() => { setMenu(null); onClose(); }}>
                Close pane
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
