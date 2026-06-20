import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getPrefs, subscribePrefs } from "../settings/preferences";
import { buildTerminalTheme } from "../styles/terminalTheme";
import { fontStack } from "../styles/fonts";
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
  setFocusTerminalFn,
  setActiveTerminalPtyId,
} from "../ai/terminalContext";
import {
  setAiPtyWriter as setAiPtyWriterInput,
  setTerminalLineReader as setTerminalLineReaderInput,
  interceptTerminalInput,
} from "../ai/terminalInput";
import { parseBridgeOsc, dispatchBridge } from "../bridge";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { SearchAddon as SearchAddonType } from "@xterm/addon-search";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TerminalHandle = {
  write: (data: string) => void;
  typeText: (text: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string;
  getSelection: () => string | null;
  clear: () => void;
  selectAll: () => void;
  hasSelection: () => boolean;
  clearSelection: () => void;
  search: (query: string) => void;
  searchNext: (query: string) => void;
  searchPrevious: (query: string) => void;
  clearSearch: () => void;
  openSearch: () => void;
  resize: () => void;
  getTerm: () => XTermType | null;
  getPtyId: () => number | null;
  getScreenElement: () => HTMLElement | null;
};

export type TerminalCallbacks = {
  onCwd?: (cwd: string) => void;
  onExit?: (code: number | null) => void;
  onFocus?: () => void;
  onData?: () => void;
  onKey?: (e: KeyboardEvent) => boolean | undefined;
  onSplit?: (dir: "row" | "col") => void;
  onFocusDirection?: (dir: "left" | "right" | "up" | "down") => void;
  onHistoryOpen?: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Session state (module-level, survives React lifecycle)
// ─────────────────────────────────────────────────────────────────────────────

type Session = {
  leafId: number;
  term: XTermType;
  fitAddon: FitAddonType;
  searchAddon: SearchAddonType;
  ptyId: number | null;
  ptyOpening: boolean;
  disposed: boolean;
  container: HTMLDivElement | null;
  visible: boolean;
  focused: boolean;
  active: boolean;
  cwd: string;
  initialCwd: string | undefined;
  callbacks: TerminalCallbacks;
  unlisteners: UnlistenFn[];
  resizeTimer: number;
  maxWaitTimer: number;
  lastCols: number;
  lastRows: number;
  resizeObserver: ResizeObserver | null;
  prefsUnsub: (() => void) | null;
  screenEl: HTMLElement | null;
  searchOpen: boolean;
  searchQuery: string;
  historyOpen: boolean;
  menuOpen: boolean;
};

const sessions = new Map<number, Session>();
let activeLeafId: number | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Parse OSC 7 cwd
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Create terminal options from preferences
// ─────────────────────────────────────────────────────────────────────────────

function buildTermOptions() {
  const p = getPrefs();
  return {
    fontFamily: fontStack(p.fontFamily),
    fontSize: p.terminalFontSize,
    cursorBlink: p.cursorBlink,
    cursorStyle: p.terminalCursorStyle,
    scrollback: p.terminalScrollback,
    allowProposedApi: true,
    allowTransparency: true,
    theme: buildTerminalTheme(
      p.terminalTheme,
      p.theme === "dark",
      p.background.enabled,
      p.accentColor,
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create a new session (terminal + PTY)
// ─────────────────────────────────────────────────────────────────────────────

export async function createSession(
  leafId: number,
  initialCwd?: string,
): Promise<Session> {
  const existing = sessions.get(leafId);
  if (existing) return existing;

  const term = new Terminal(buildTermOptions());
  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  term.loadAddon(fitAddon);
  term.loadAddon(searchAddon);

  const session: Session = {
    leafId,
    term,
    fitAddon,
    searchAddon,
    ptyId: null,
    ptyOpening: false,
    disposed: false,
    container: null,
    visible: false,
    focused: false,
    active: false,
    cwd: "",
    initialCwd,
    callbacks: {},
    unlisteners: [],
    resizeTimer: 0,
    maxWaitTimer: 0,
    lastCols: -1,
    lastRows: -1,
    resizeObserver: null,
    prefsUnsub: null,
    screenEl: null,
    searchOpen: false,
    searchQuery: "",
    historyOpen: false,
    menuOpen: false,
  };

  sessions.set(leafId, session);

  // ── OSC Handlers ──────────────────────────────────────────────────────────
  term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7Cwd(data);
    if (cwd) {
      session.cwd = cwd;
      if (session.active) setActiveTerminalCwd(cwd);
      session.callbacks.onCwd?.(cwd);
    }
    return true;
  });

  term.parser.registerOscHandler(133, (data) => {
    if (!session.active) return true;
    if (data.startsWith("D")) {
      const code = Number.parseInt(data.split(";")[1] ?? "", 10);
      setActiveTerminalExit(Number.isNaN(code) ? null : code);
      clearCurrentCommand();
    }
    if (data.startsWith("C")) markCommandStart();
    if (data.startsWith("B")) {
      const buf = term.buffer.active;
      setPromptPosition({ row: buf.cursorY + buf.viewportY, col: buf.cursorX });
    }
    if (data.startsWith("A")) setPromptPosition(null);
    return true;
  });

  term.parser.registerOscHandler(778, (data) => {
    if (!session.active || !data.startsWith("husk;cmd;")) return true;
    const cmd = data.slice("husk;cmd;".length).replace(/%3B/g, ";");
    setCurrentCommand(cmd.trim());
    return true;
  });

  term.parser.registerOscHandler(777, (data) => {
    const cmd = parseBridgeOsc(data);
    if (cmd) dispatchBridge(cmd);
    return true;
  });

  // ── Key Handler ───────────────────────────────────────────────────────────
  term.attachCustomKeyEventHandler((e) => {
    // Let TerminalView handle autocomplete keys first
    const handled = session.callbacks.onKey?.(e);
    if (handled === false) return false;

    if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      session.searchOpen = true;
      if (session.active) setActiveTerminalSearchOpener(() => { session.searchOpen = true; });
      return false;
    }
    if (e.type === "keydown" && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") {
      session.historyOpen = true;
      if (session.active) session.callbacks.onHistoryOpen?.();
      return false;
    }
    if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && term.hasSelection()) {
      const sel = term.getSelection();
      if (sel) void writeText(sel);
      return false;
    }
    if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      e.preventDefault();
      void readText().then((t) => {
        if (t && session.ptyId != null) void invoke("pty_write", { id: session.ptyId, data: t });
      });
      return false;
    }
    // Cmd+D splits right, Cmd+Shift+D splits down. Meta-only (macOS) so we
    // never clash with Ctrl+D (EOF) on Linux/Windows.
    if (e.type === "keydown" && e.metaKey && e.key.toLowerCase() === "d") {
      session.callbacks.onSplit?.(e.shiftKey ? "col" : "row");
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
        session.callbacks.onFocusDirection?.(dir);
        return false;
      }
    }
    return true;
  });

  // ── PTY Spawn ─────────────────────────────────────────────────────────────
  session.ptyOpening = true;
  try {
  const id = await invoke<number>("pty_spawn", {
    cols: term.cols || 80,
    rows: term.rows || 24,
    cwd: initialCwd ?? null,
  });

  if (session.disposed) {
    void invoke("pty_kill", { id });
    return session;
  }
  session.ptyId = id;

    // Buffer for scanning husk commands in PTY output (remote hosts without integration)
    let outputBuffer = "";
    const HUSK_CMD_RE = /husk\s+(cp|open|preview|notify|diff)\s+(.+?)(?:\r?\n|$)/;
    const HUSK_NOT_FOUND_RE = /Command 'husk' not found[^\n]*\n?/g;

    session.unlisteners.push(
      await listen<number[]>(`pty://data/${id}`, (e) => {
        const data = new Uint8Array(e.payload);
        const text = new TextDecoder().decode(data);
        outputBuffer += text;

        // Scan for husk commands in buffered output
        let match: RegExpMatchArray | null;
        while ((match = outputBuffer.match(HUSK_CMD_RE)) !== null) {
          const [, verb, rest] = match;
          const payload = `husk;${verb};${rest.trim()}`;
          const cmd = parseBridgeOsc(payload);
          if (cmd && session.active) {
            dispatchBridge(cmd);
          }
          // Remove the matched command from buffer
          const idx = match.index ?? 0;
          outputBuffer = outputBuffer.slice(0, idx) + outputBuffer.slice(idx + match[0].length);
        }

        // Remove "command not found" errors from buffer
        outputBuffer = outputBuffer.replace(HUSK_NOT_FOUND_RE, "");

        // Write remaining buffer content to terminal
        if (outputBuffer.length > 4096) {
          // Flush if buffer gets too large (no husk command found)
          term.write(new TextEncoder().encode(outputBuffer));
          outputBuffer = "";
        } else if (outputBuffer.includes("\n") || outputBuffer.includes("\r")) {
          // Flush on line boundaries
          const lastNL = Math.max(outputBuffer.lastIndexOf("\n"), outputBuffer.lastIndexOf("\r"));
          if (lastNL >= 0) {
            term.write(new TextEncoder().encode(outputBuffer.slice(0, lastNL + 1)));
            outputBuffer = outputBuffer.slice(lastNL + 1);
          }
        } else if (outputBuffer.length > 0 && !outputBuffer.match(/husk\s+(cp|open|preview|notify|diff)/)) {
          // No partial husk command — flush immediately (echo/typing)
          term.write(new TextEncoder().encode(outputBuffer));
          outputBuffer = "";
        }
      }),
    );
    session.unlisteners.push(
      await listen(`pty://exit/${id}`, () => {
        term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
      }),
    );

    // Data handler
    let typingTimer = 0;
    term.onData((data: string) => {
      const out = interceptTerminalInput(data);
      if (out === null) return;
      void invoke("pty_write", { id, data: out });
      if (session.active) {
        setTerminalTyping(true);
        window.clearTimeout(typingTimer);
        typingTimer = window.setTimeout(() => setTerminalTyping(false), 400);
      }
      // Trigger autocomplete check
      session.callbacks.onData?.();
    });

    // Resize handler
    term.onResize(({ cols, rows }) => {
      if (cols === session.lastCols && rows === session.lastRows) return;
      session.lastCols = cols;
      session.lastRows = rows;
      void invoke("pty_resize", { id, cols, rows });
    });

    session.ptyOpening = false;
  } catch (e) {
    session.ptyOpening = false;
    console.error("[husk] PTY spawn failed:", e);
  }

  // ── Preferences watcher ─────────────────────────────────────────────────
  session.prefsUnsub = subscribePrefs(() => {
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
    window.setTimeout(() => {
      try { fitAddon.fit(); } catch {}
    }, 90);
  });

  return session;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attach session to a DOM container
// ─────────────────────────────────────────────────────────────────────────────

export function attachSession(leafId: number, container: HTMLDivElement): void {
  const session = sessions.get(leafId);
  if (!session || session.disposed) return;

  if (session.container === container) return;
  if (session.container) detachSession(leafId);

  session.container = container;

  // Move existing xterm element into container (preserves buffer + scrollback)
  const element = session.term.element;
  if (element) {
    container.appendChild(element);
  } else {
    // First-time open
    session.term.open(container);
  }
  session.fitAddon.fit();
  session.screenEl = container.querySelector(".xterm-screen") as HTMLElement | null;

  const doFit = () => {
    if (!session.term || !container.clientWidth || !container.clientHeight) return;
    try {
      session.fitAddon.fit();
      session.term.scrollToBottom();
    } catch {}
  };

  session.resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(session.resizeTimer);
    session.resizeTimer = window.setTimeout(doFit, 150);
  });
  session.resizeObserver.observe(container);

  session.maxWaitTimer = window.setInterval(() => {
    if (session.resizeTimer) {
      window.clearTimeout(session.resizeTimer);
      session.resizeTimer = 0;
      doFit();
    }
  }, 500);

  session.lastCols = session.term.cols;
  session.lastRows = session.term.rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM Parking (preserve xterm element across React remounts)
// ─────────────────────────────────────────────────────────────────────────────

let parkingDiv: HTMLDivElement | null = null;

function getParkingDiv(): HTMLDivElement {
  if (!parkingDiv) {
    parkingDiv = document.createElement("div");
    parkingDiv.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;";
    document.body.appendChild(parkingDiv);
  }
  return parkingDiv;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detach session from DOM (keep PTY alive, park DOM element)
// ─────────────────────────────────────────────────────────────────────────────

export function detachSession(leafId: number): void {
  const session = sessions.get(leafId);
  if (!session) return;

  if (session.resizeObserver) {
    session.resizeObserver.disconnect();
    session.resizeObserver = null;
  }
  window.clearTimeout(session.resizeTimer);
  window.clearInterval(session.maxWaitTimer);
  session.resizeTimer = 0;
  session.maxWaitTimer = 0;

  // Park the xterm element instead of removing it
  const element = session.term.element;
  if (element) {
    getParkingDiv().appendChild(element);
  }

  session.container = null;
  session.screenEl = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Set visibility and focus
// ─────────────────────────────────────────────────────────────────────────────

export function setSessionVisible(leafId: number, visible: boolean): void {
  const session = sessions.get(leafId);
  if (!session) return;
  session.visible = visible;
  if (visible && session.container) {
    session.fitAddon.fit();
  }
}

export function setSessionFocused(leafId: number, focused: boolean): void {
  const session = sessions.get(leafId);
  if (!session) return;
  session.focused = focused;
  if (focused) {
    session.term.focus();
    activeLeafId = leafId;
  }
}

export function setSessionActive(leafId: number, active: boolean): void {
  const session = sessions.get(leafId);
  if (!session) return;
  session.active = active;

  if (active) {
    setActiveTerminalPtyId(session.ptyId);
    setActiveTerminalReader(() => {
      const buf = session.term.buffer.active;
      const lines: string[] = [];
      let chars = 0;
      const maxChars = 8192;
      for (let i = buf.length - 1; i >= 0; i -= 1) {
        const line = buf.getLine(i)?.translateToString(true) ?? "";
        if (chars + line.length + 1 > maxChars && lines.length > 0) break;
        lines.push(line);
        chars += line.length + 1;
      }
      return lines.reverse().join("\n").replace(/\n+$/, "");
    });

    setActiveTerminalRunner((cmd: string) => {
      if (session.ptyId != null) void invoke("pty_write", { id: session.ptyId, data: `${cmd}\r` });
      session.term.focus();
    });

    setActiveTerminalTyper((text: string) => {
      if (session.ptyId != null) void invoke("pty_write", { id: session.ptyId, data: text });
      session.term.focus();
    });

    setActiveTerminalSearchOpener(() => { session.searchOpen = true; });
    setActiveTerminalSearcher((q: string) => {
      session.searchOpen = true;
      session.searchQuery = q;
      try { session.searchAddon.findNext(q, { incremental: true }); } catch {}
    });

    setTerminalLineReaderInput(() => {
      const buf = session.term.buffer.active;
      return buf.getLine(buf.cursorY)?.translateToString(true) ?? "";
    });

    setAiPtyWriterInput((data: string) => {
      if (session.ptyId != null) void invoke("pty_write", { id: session.ptyId, data });
    });

    setFocusTerminalFn(() => session.term.focus());

    if (session.cwd) setActiveTerminalCwd(session.cwd);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Get handle for a session (exposed to TerminalView component)
// ─────────────────────────────────────────────────────────────────────────────

export function getSessionHandle(leafId: number): TerminalHandle | null {
  const session = sessions.get(leafId);
  if (!session) return null;

  return {
    write: (data: string) => {
      if (session.ptyId != null) void invoke("pty_write", { id: session.ptyId, data });
    },
    typeText: (text: string) => {
      // Type text character by character without sending newline (user must press Enter)
      if (session.ptyId != null) {
        // Strip any trailing newline/carriage return to prevent auto-execution
        const cleaned = text.replace(/[\r\n]+$/, "");
        void invoke("pty_write", { id: session.ptyId, data: cleaned });
      }
    },
    focus: () => session.term.focus(),
    getBuffer: (maxLines = 200): string => {
      const buf = session.term.buffer.active;
      const total = buf.length;
      const lines: string[] = [];
      const start = Math.max(0, total - maxLines);
      for (let i = start; i < total; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      }
      while (lines.length && lines[lines.length - 1] === "") lines.pop();
      return lines.join("\n");
    },
    getSelection: () => {
      const sel = session.term.getSelection();
      return sel.length > 0 ? sel : null;
    },
    clear: () => session.term.clear(),
    selectAll: () => session.term.selectAll(),
    hasSelection: () => session.term.hasSelection(),
    clearSelection: () => session.term.clearSelection(),
    search: (query: string) => {
      session.searchQuery = query;
      try { session.searchAddon.findNext(query, { incremental: true }); } catch {}
    },
    searchNext: (query: string) => {
      try { session.searchAddon.findNext(query); } catch {}
    },
    searchPrevious: (query: string) => {
      try { session.searchAddon.findPrevious(query); } catch {}
    },
    clearSearch: () => session.searchAddon.clearDecorations(),
    openSearch: () => { session.searchOpen = true; },
    resize: () => {
      try { session.fitAddon.fit(); } catch {}
    },
    getTerm: () => session.term,
    getPtyId: () => session.ptyId,
    getScreenElement: () => session.screenEl,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispose session (only call when pane is actually closed)
// ─────────────────────────────────────────────────────────────────────────────

export function disposeSession(leafId: number): void {
  const session = sessions.get(leafId);
  if (!session) return;

  session.disposed = true;

  if (session.resizeObserver) {
    session.resizeObserver.disconnect();
    session.resizeObserver = null;
  }
  window.clearTimeout(session.resizeTimer);
  window.clearInterval(session.maxWaitTimer);

  for (const un of session.unlisteners) un();
  session.unlisteners = [];

  if (session.ptyId != null) {
    void invoke("pty_kill", { id: session.ptyId });
  }

  session.prefsUnsub?.();
  session.term.dispose();
  sessions.delete(leafId);

  if (activeLeafId === leafId) activeLeafId = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Check if session exists
// ─────────────────────────────────────────────────────────────────────────────

export function hasSession(leafId: number): boolean {
  return sessions.has(leafId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Get session for internal use
// ─────────────────────────────────────────────────────────────────────────────

export function getSession(leafId: number): Session | undefined {
  return sessions.get(leafId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Set callbacks
// ─────────────────────────────────────────────────────────────────────────────

export function setSessionCallbacks(leafId: number, callbacks: TerminalCallbacks): void {
  const session = sessions.get(leafId);
  if (session) session.callbacks = callbacks;
}
