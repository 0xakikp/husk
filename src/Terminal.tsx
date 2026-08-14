import { useEffect, useRef, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  getPromptPosition,
  isCommandRunning,
} from "./ai/terminalContext";
import { getShellHistory } from "./shellHistory";
import { TerminalHistoryPanel } from "./TerminalHistory";
import { useAutocomplete } from "./terminal/useAutocomplete";
import { AutocompleteBar } from "./terminal/AutocompleteBar";
import {
  createSession,
  attachSession,
  detachSession,
  setSessionVisible,
  setSessionFocused,
  setSessionActive,
  getSessionHandle,
  setSessionCallbacks,
  registerTerminalLogsOpener,
  type TerminalHandle,
} from "./terminal/registry";
import type { TerminalCheckpoint } from "./terminalPanes";
import "@xterm/xterm/css/xterm.css";

/** A single xterm.js terminal backed by a Rust PTY session.
 *  Terminal lifecycle is managed by the registry; this component only
 *  handles DOM attachment and UI overlays (search, history, menu, autocomplete). */
export function TerminalView({
  leafId,
  active = true,
  initialCwd,
  checkpoint,
  restored = false,
  onSplit,
  onClose,
  canClose = false,
  onFocus,
  onOpenLogs,
  onCwd,
  onCommandComplete,
  onFocusDirection: _onFocusDirection,
}: {
  leafId: number;
  active?: boolean;
  initialCwd?: string;
  checkpoint?: TerminalCheckpoint;
  restored?: boolean;
  onSplit?: (dir: "row" | "col") => void;
  onClose?: () => void;
  canClose?: boolean;
  onFocus?: () => void;
  onOpenLogs?: (leafId: number) => void;
  onCwd?: (cwd: string) => void;
  onCommandComplete?: (run: { command: string; cwd: string; exitCode: number | null; at: number }) => void;
  onFocusDirection?: (dir: "left" | "right" | "up" | "down") => void;
}) {
  void _onFocusDirection; // used by parent key handler, not directly here
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<TerminalHandle | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  /* xterm's native key handler is registered once per terminal session. Keep
     these values in refs so it immediately sees an overlay opened by that
     same native key event, rather than a stale render's state value. */
  const searchOpenRef = useRef(false);
  const historyOpenRef = useRef(false);
  const [historyEntries, setHistoryEntries] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [restoreNoticeOpen, setRestoreNoticeOpen] = useState(restored);
  const hostRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLElement | null>(null);
  const mouseDownOnOverlayRef = useRef(false);

  /* The global launcher resolves this opener from the focused leaf; the shared
     workspace Inspector owns the visible Logs panel, not this xterm surface. */
  useEffect(() => registerTerminalLogsOpener(leafId, () => onOpenLogs?.(leafId)), [leafId, onOpenLogs]);

  // ── Create session on mount (registry handles terminal + PTY) ────────────
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        await createSession(leafId, initialCwd);
        if (cancelled) return;

        const container = containerRef.current;
        if (!container) {
          console.error("[husk] Terminal container not found for leaf", leafId);
          return;
        }

        attachSession(leafId, container);
        handleRef.current = getSessionHandle(leafId);

        // Get screen element for click-to-position
        const term = handleRef.current?.getTerm();
        if (term?.element) {
          screenRef.current = term.element.querySelector(".xterm-screen") as HTMLElement | null;
        }
        console.log("[husk] Terminal session created for leaf", leafId);
      } catch (e) {
        console.error("[husk] Failed to create terminal session:", e);
      }
    })();

    return () => {
      cancelled = true;
      detachSession(leafId);
      handleRef.current = null;
    };
  }, [leafId, initialCwd]);

  // ── Track visibility / focus / active state ───────────────────────────────
  useEffect(() => {
    setSessionVisible(leafId, active);
  }, [leafId, active]);

  // True while the user is cycling shell history with arrow keys; used to
  // suppress the autocomplete dropdown so it doesn't block history navigation.
  const historyNavigatingRef = useRef(false);
  const historyNavTimerRef = useRef<number>(0);

  useEffect(() => {
    if (active) {
      setSessionFocused(leafId, true);
      setSessionActive(leafId, true);
      setSessionCallbacks(leafId, {
        onCwd,
        onCommandComplete,
        onFocus: () => onFocus?.(),
        onData: () => {
          // Don't trigger autocomplete if the user is cycling shell history;
          // the shell recalled command would otherwise open the dropdown and
          // block further Up arrow presses.
          if (!historyNavigatingRef.current) {
            scheduleAutoRef.current();
          }
        },
        onSplit: (dir) => onSplit?.(dir),
        onFocusDirection: (dir) => _onFocusDirection?.(dir),
        onHistoryOpen: () => openHistory(),
        onKey: (e) => {
          if (e.type !== "keydown") return undefined;
          // An HTML overlay owns input while it is open. Returning false here
          // prevents xterm from receiving keystrokes during the small window
          // before React has committed the state update and moved DOM focus.
          if (historyOpenRef.current || searchOpenRef.current) return false;

          const isHistoryArrow = e.key === "ArrowUp" || e.key === "ArrowDown";
          if (autoStateRef.current.visible && isHistoryArrow) {
            // The visible menu explicitly advertises arrow navigation. Keep the
            // event out of the shell so it cannot recall a history entry while
            // the user is choosing a completion. Esc dismisses the menu and
            // restores the shell's usual ↑/↓ history behaviour.
            e.preventDefault();
            e.stopPropagation();
            navigateAutoRef.current(e.key === "ArrowUp" ? -1 : 1);
            return false;
          }

          if (isHistoryArrow) {
            // Mark that the user is navigating shell history. Suppress
            // autocomplete for a short window so the dropdown doesn't open
            // from the recalled command.
            historyNavigatingRef.current = true;
            window.clearTimeout(historyNavTimerRef.current);
            historyNavTimerRef.current = window.setTimeout(() => {
              historyNavigatingRef.current = false;
            }, 300);

            // While arrow keys are for shell history, dismiss any open dropdown
            // and let the shell handle the key.
            if (autoStateRef.current.visible) {
              dismissAutoRef.current();
            }
            return undefined;
          }

          if (!autoStateRef.current.visible) return undefined;
          if (e.key === "Tab") {
            e.preventDefault();
            acceptAutoRef.current();
            return false;
          }
          if (e.key === "Enter" || e.key === "Return") {
            // Dismiss the autocomplete panel and let Enter run the typed command.
            // Tab is the dedicated accept shortcut; Enter should not silently
            // replace the user's input with the first suggestion.
            e.preventDefault();
            dismissAutoRef.current();
            return true;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            dismissAutoRef.current();
            return false;
          }
          return undefined;
        },
      });
    } else {
      setSessionFocused(leafId, false);
      setSessionActive(leafId, false);
    }
  }, [leafId, active, onFocus, onCwd, onCommandComplete]);

  // ── Autocomplete ──────────────────────────────────────────────────────────
  const {
    state: autoState,
    stateRef: autoStateRef,
    scheduleCheck: scheduleAutoCheck,
    accept: acceptAuto,
    navigate: navigateAuto,
    dismiss: dismissAuto,
  } = useAutocomplete(handleRef);

  const scheduleAutoRef = useRef(scheduleAutoCheck);
  const acceptAutoRef = useRef(acceptAuto);
  const navigateAutoRef = useRef(navigateAuto);
  const dismissAutoRef = useRef(dismissAuto);
  useEffect(() => {
    scheduleAutoRef.current = scheduleAutoCheck;
    acceptAutoRef.current = acceptAuto;
    navigateAutoRef.current = navigateAuto;
    dismissAutoRef.current = dismissAuto;
  });

  // ── Search ────────────────────────────────────────────────────────────────
  const closeSearch = () => {
    searchOpenRef.current = false;
    setSearchOpen(false);
    setQuery("");
    handleRef.current?.clearSearch();
    handleRef.current?.focus();
  };

  useEffect(() => {
    if (!searchOpen || !query) return;
    handleRef.current?.search(query);
  }, [query, searchOpen]);

  // ── History ───────────────────────────────────────────────────────────────
  const selectHistory = (command: string) => {
    // Type the command at the prompt WITHOUT executing it (user must press Enter)
    const typer = handleRef.current?.typeText;
    if (typer) {
      typer(command);
    } else {
      // Fallback: write with newline stripped (won't auto-execute)
      handleRef.current?.write(command.replace(/\n$/, ""));
    }
    historyOpenRef.current = false;
    setHistoryOpen(false);
    handleRef.current?.focus();
  };

  const openHistory = () => {
    // Clear terminal screen to wipe any fzf/shell UI before showing our panel
    handleRef.current?.clear();
    // Set the ref before React renders the picker. Otherwise a fast next
    // keystroke can still reach xterm and appear behind the history popup.
    historyOpenRef.current = true;
    setHistoryOpen(true);
    setHistoryLoading(true);
    void getShellHistory()
      .then((rows) => setHistoryEntries(rows.map((r) => r.command)))
      .catch(() => setHistoryEntries([]))
      .finally(() => setHistoryLoading(false));
  };

  // ── Context menu ──────────────────────────────────────────────────────────
  const menuCopy = () => {
    setMenu(null);
    const sel = handleRef.current?.getSelection();
    if (sel) void writeText(sel);
    handleRef.current?.clearSelection();
  };
  const menuPaste = () => {
    setMenu(null);
    void readText()
      .then((t) => {
        if (t) handleRef.current?.write(t);
        handleRef.current?.focus();
      })
      .catch(() => {});
  };

  // ── Click-to-position cursor ──────────────────────────────────────────────
  const handleTerminalMouseDown = (e: React.MouseEvent) => {
    // Track if mousedown started on an overlay — if so, skip click-to-position
    const target = e.target as HTMLElement;
    mouseDownOnOverlayRef.current = !target.closest(".terminal-host");
  };

  const handleTerminalClick = (e: React.MouseEvent) => {
    const handle = handleRef.current;
    if (!handle) return;
    if (isCommandRunning()) return;
    if (handle.hasSelection()) return;

    // Skip if the click started on an overlay (autocomplete, search, history, menu)
    // This prevents cursor movement when clicking just to dismiss an overlay
    if (mouseDownOnOverlayRef.current) return;

    // Only activate on direct terminal screen clicks
    const target = e.target as HTMLElement;
    if (!target.closest(".terminal-host")) return;

    const term = handle.getTerm();
    if (!term) return;

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

    let col = Math.floor(x / cellW);
    const row = Math.floor(y / cellH) + buf.viewportY;

    const curCol = buf.cursorX;
    const curRow = buf.cursorY + buf.viewportY;

    // Only handle clicks on the cursor's own row. Moving between rows would
    // require up/down arrow keys — but shells (zsh/bash/fish) interpret those
    // as history navigation, which recalls a previously-run command onto the
    // prompt and looks like a random paste of old text (phantom paste bug,
    // typically triggered by clicking anywhere after the terminal sat idle).
    if (row !== curRow) return;
    if (row === prompt.row && col < prompt.col) return;
    if (col < 0 || col >= term.cols) return;

    // Don't move right past the current input end: sending right arrows beyond
    // the typed command can cause zsh-autosuggestions/fish to accept a history
    // suggestion and paste a previous command (phantom paste bug).
    const line = buf.getLine(curRow)?.translateToString(true) ?? "";
    const inputEnd = Math.max(curCol, line.trimEnd().length);
    col = Math.min(col, inputEnd);

    if (col === curCol) return;

    const colDelta = col - curCol;

    const arrows: string[] = [];
    for (let i = 0; i < Math.abs(colDelta); i++) {
      arrows.push(colDelta < 0 ? "\x1b[D" : "\x1b[C");
    }
    const seq = arrows.join("");
    if (seq) handle.write(seq);
  };

  const handleTerminalMouseMove = (e: React.MouseEvent) => {
    const handle = handleRef.current;
    const host = hostRef.current;
    if (!handle || !host) {
      host && (host.style.cursor = "");
      return;
    }
    if (isCommandRunning() || handle.hasSelection()) {
      host.style.cursor = "";
      return;
    }

    const term = handle.getTerm();
    if (!term) {
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
    const MENU_W = 168;
    const MENU_H = 220;
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8);
    setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  };

  return (
    <div
      ref={hostRef}
      className="terminal-host-wrap"
      onMouseDown={(e) => {
        handleTerminalMouseDown(e);
        onFocus?.();
        handleRef.current?.focus();
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
      {restoreNoticeOpen && (
        <div className="terminal-restore-note" role="status">
          <span className="terminal-restore-dot" aria-hidden="true">●</span>
          <span>restored · fresh shell</span>
          {checkpoint?.cwd && <code title={checkpoint.cwd}>{checkpoint.cwd}</code>}
          {checkpoint?.command && (
            <>
              <span className="terminal-restore-sep">·</span>
              <span className="terminal-restore-last" title={checkpoint.command}>last: {checkpoint.command}</span>
              {checkpoint.exitCode != null && (
                <span className={checkpoint.exitCode === 0 ? "terminal-restore-ok" : "terminal-restore-bad"}>
                  exit {checkpoint.exitCode}
                </span>
              )}
            </>
          )}
          <button type="button" onClick={() => setRestoreNoticeOpen(false)} aria-label="Dismiss restored session summary">×</button>
        </div>
      )}
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
                  if (e.shiftKey) handleRef.current?.searchPrevious(query);
                  else handleRef.current?.searchNext(query);
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
            historyOpenRef.current = false;
            setHistoryOpen(false);
            handleRef.current?.focus();
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
            <button type="button" className="ectx-item" onClick={() => { setMenu(null); handleRef.current?.selectAll(); }}>
              Select all
            </button>
            <button type="button" className="ectx-item" onClick={() => { setMenu(null); handleRef.current?.clear(); handleRef.current?.focus(); }}>
              Clear
            </button>
            <button type="button" className="ectx-item" onClick={() => { setMenu(null); searchOpenRef.current = true; setSearchOpen(true); }}>
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
