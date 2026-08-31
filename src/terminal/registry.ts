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
  recordCommandRun,
  publishTerminalCommandRun,
  getCurrentCommand,
  getCommandStartTime,
  markCommandStart,
  setPromptPosition,
  setFocusTerminalFn,
  setActiveTerminalPtyId,
  setActiveTerminalDraftReader,
  setActiveRemoteTerminal,
  type CommandRun,
} from "../ai/terminalContext";
import { recordFailure, clearFailure, collapseFailure } from "./failureStore";
import { clearNextSteps, collapseNextSteps, recordNextSteps } from "./nextSteps";
import { clearGitActivity, recordGitActivity } from "./gitActivityStore";
import { extractLocalDevUrls, recordPorts } from "./portStore";
import { recordSensitiveOutput } from "./sensitiveOutputStore";
import { completeTask, startTask } from "./taskStore";
import { clearEnvironmentWarning, recordEnvironmentWarning } from "./environmentWarnings";
import { getEnvSignals } from "./envSignals";
import { recordTimelineEvent } from "../timeline/store";
import { safeTimelineCommand } from "../timeline/commandMetadata";
import { refreshWorkflowSuggestion } from "../workflows/suggestions";
import { getWorkspaceRoot, syncWorkspaceRootToCwd } from "../workspace/store";
import {
  setAiPtyWriter as setAiPtyWriterInput,
  setTerminalLineReader as setTerminalLineReaderInput,
  interceptTerminalInput,
} from "../ai/terminalInput";
import { parseBridgeOsc, dispatchBridge } from "../bridge";
import type { Terminal as XTermType } from "@xterm/xterm";
import type { SearchAddon as SearchAddonType } from "@xterm/addon-search";
import type { FitAddon as FitAddonType } from "@xterm/addon-fit";
import { absolutePromptPosition, readEditablePrompt } from "./promptDraft";
import { parseRemoteShellTarget } from "./remoteShell";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type TerminalHandle = {
  write: (data: string) => void;
  typeText: (text: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string;
  getSelection: () => string | null;
  getLastCommandRun: () => CommandRun | null;
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
  onCommandComplete?: (run: { command: string; cwd: string; exitCode: number | null; at: number }) => void;
  onExit?: (code: number | null) => void;
  onFocus?: () => void;
  onData?: () => void;
  onKey?: (e: KeyboardEvent) => boolean | undefined;
  onSplit?: (dir: "row" | "col") => void;
  onFocusDirection?: (dir: "left" | "right" | "up" | "down") => void;
  onHistoryOpen?: () => void;
};

export type TerminalOutputListener = (data: string) => void;
type TerminalLogsOpener = () => void;

// ─────────────────────────────────────────────────────────────────────────────
// Session state (module-level, survives React lifecycle)
// ─────────────────────────────────────────────────────────────────────────────

type Session = {
  leafId: number;
  /** Distinguishes repeated routines across fresh PTYs without persisting any
   * terminal process identifiers. */
  workflowSessionId: string;
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
  typingTimer: number;
  lastCols: number;
  lastRows: number;
  lastWidth: number;
  lastHeight: number;
  pendingPtyCols: number;
  pendingPtyRows: number;
  ptyResizeInFlight: boolean;
  resizeObserver: ResizeObserver | null;
  prefsUnsub: (() => void) | null;
  screenEl: HTMLElement | null;
  searchOpen: boolean;
  searchQuery: string;
  historyOpen: boolean;
  menuOpen: boolean;
  isRemoteShell: boolean;
  remoteTarget: string | null;
  lastCompletedRun: CommandRun | null;
  /** Start of the editable prompt for this PTY (not globally shared). */
  promptPosition: { row: number; col: number } | null;
  /** Absolute buffer row where the running command's output began (OSC 133 C). */
  cmdStartRow: number | null;
  /** Command lifecycle is retained per PTY so hidden terminal tabs can still
   * report their own completion state without corrupting the active terminal. */
  currentCommand: string;
  commandStartedAt: number;
  /** Small rolling output sample for live local-server detection. */
  liveOutputTail: string;
};

/** Keep the native PTY at the same grid size as xterm.
 *
 * xterm reflows its buffer synchronously, while a Tauri command crosses an
 * asynchronous boundary. Serialising those commands prevents an older resize
 * response from landing after a newer one. If the grid changes while one
 * request is in flight, only the latest dimensions are sent next. */
function flushPtyResize(session: Session): void {
  if (
    session.disposed ||
    session.ptyResizeInFlight ||
    session.ptyId == null ||
    session.pendingPtyCols < 1 ||
    session.pendingPtyRows < 1
  ) {
    return;
  }

  const cols = session.pendingPtyCols;
  const rows = session.pendingPtyRows;
  session.pendingPtyCols = -1;
  session.pendingPtyRows = -1;
  session.ptyResizeInFlight = true;

  void invoke("pty_resize", { id: session.ptyId, cols, rows })
    .catch((error) => console.warn("[husk] PTY resize failed:", error))
    .finally(() => {
      session.ptyResizeInFlight = false;
      flushPtyResize(session);
    });
}

function queuePtyResize(session: Session, cols: number, rows: number): void {
  session.pendingPtyCols = cols;
  session.pendingPtyRows = rows;
  flushPtyResize(session);
}

/** Fit one attached xterm and preserve whether the user was following the
 * bottom. All fit entry points go through here so the visual grid and PTY do
 * not spend hundreds of milliseconds at different sizes. */
function fitAttachedSession(session: Session): void {
  const container = session.container;
  if (!container || !container.clientWidth || !container.clientHeight) return;

  try {
    const dimensions = session.fitAddon.proposeDimensions();
    if (!dimensions) return;

    session.lastWidth = container.clientWidth;
    session.lastHeight = container.clientHeight;

    if (dimensions.cols === session.term.cols && dimensions.rows === session.term.rows) {
      return;
    }

    const buffer = session.term.buffer.active;
    const wasFollowingBottom = buffer.viewportY >= buffer.baseY;
    session.fitAddon.fit();
    if (wasFollowingBottom) session.term.scrollToBottom();
  } catch {}
}

const sessions = new Map<number, Session>();
let activeLeafId: number | null = null;
/* Output listeners deliberately live beside sessions rather than in React.
   A terminal's PTY survives tab switches, and a Logs drawer must be able to
   subscribe to the same stream without affecting xterm's rendering or input. */
const outputListeners = new Map<number, Set<TerminalOutputListener>>();
const logsOpeners = new Map<number, TerminalLogsOpener>();

/** Return only the editable shell input after the prompt. `Ctrl+L` can make a
 * draft disappear visually while leaving it in readline, so the AI run path
 * must inspect xterm's real prompt buffer before writing anything. */
function readPromptDraft(session: Pick<Session, "term" | "promptPosition">): string {
  return readEditablePrompt(session.term.buffer.active, session.promptPosition);
}

/** Let app-wide commands open the drawer belonging to the focused terminal. */
export function registerTerminalLogsOpener(leafId: number, opener: TerminalLogsOpener): () => void {
  logsOpeners.set(leafId, opener);
  return () => {
    if (logsOpeners.get(leafId) === opener) logsOpeners.delete(leafId);
  };
}

export function openActiveTerminalLogs(): boolean {
  if (activeLeafId == null) return false;
  const opener = logsOpeners.get(activeLeafId);
  if (!opener) return false;
  opener();
  return true;
}

export function subscribeTerminalOutput(leafId: number, listener: TerminalOutputListener): () => void {
  let listeners = outputListeners.get(leafId);
  if (!listeners) {
    listeners = new Set();
    outputListeners.set(leafId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = outputListeners.get(leafId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) outputListeners.delete(leafId);
  };
}

function emitTerminalOutput(leafId: number, data: string): void {
  const listeners = outputListeners.get(leafId);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(data);
    } catch (error) {
      console.error("[husk] Terminal output listener failed:", error);
    }
  }
}

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
    /* Bold everything, and push what the program already bolds one step
       further, so SGR-bold text stays distinguishable instead of collapsing
       into the surrounding weight. */
    fontWeight: p.terminalBoldFont ? ("bold" as const) : ("normal" as const),
    fontWeightBold: p.terminalBoldFont ? ("900" as const) : ("bold" as const),
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
    workflowSessionId: `term_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
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
    typingTimer: 0,
    lastCols: -1,
    lastRows: -1,
    lastWidth: -1,
    lastHeight: -1,
    pendingPtyCols: -1,
    pendingPtyRows: -1,
    ptyResizeInFlight: false,
    resizeObserver: null,
    prefsUnsub: null,
    screenEl: null,
    searchOpen: false,
    searchQuery: "",
    historyOpen: false,
    menuOpen: false,
    isRemoteShell: false,
    remoteTarget: null,
    lastCompletedRun: null,
    promptPosition: null,
    cmdStartRow: null,
    currentCommand: "",
    commandStartedAt: 0,
    liveOutputTail: "",
  };
  sessions.set(leafId, session);

  // ── OSC Handlers ──────────────────────────────────────────────────────────
  term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7Cwd(data);
    if (cwd) {
      session.cwd = cwd;
      if (session.active) setActiveTerminalCwd(cwd);
      /* Workspace root follows the terminal so timeline/explorer/root never
         drift — local shells only, a remote path is not a local folder. */
      if (session.active && !session.isRemoteShell) syncWorkspaceRootToCwd(cwd);
      /* The restored launch directory must also remain local. A remote shell
         may emit OSC 7 with a valid-looking `/path`, but spawning the next
         local PTY there would be incorrect. */
      if (!session.isRemoteShell) session.callbacks.onCwd?.(cwd);
    }
    return true;
  });

  term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith("B")) {
      const buf = term.buffer.active;
      const pos = absolutePromptPosition(buf);
      session.promptPosition = pos;
      if (session.active) setPromptPosition(pos);
    }
    // Note: OSC 133 A (prompt start) is deliberately ignored — some shell
    // frameworks emit it after B, which clears the position we just set.
    if (data.startsWith("D")) {
      const code = Number.parseInt(data.split(";")[1] ?? "", 10);
      const exitCode = Number.isNaN(code) ? null : code;
      if (session.active) setActiveTerminalExit(exitCode);
      /* Harvest just this command's output, using the row marked at C. Bounded on
         both axes: a build can emit tens of thousands of rows, and this runs on
         every prompt. */
      if (session.cmdStartRow != null) {
        const b = term.buffer.active;
        const endRow = b.baseY + b.cursorY;
        const startRow = Math.max(session.cmdStartRow, endRow - 500);
        const lines: string[] = [];
        let chars = 0;
        for (let i = startRow; i < endRow && chars < 8192; i += 1) {
          const line = b.getLine(i)?.translateToString(true) ?? "";
          lines.push(line);
          chars += line.length + 1;
        }
        const output = lines.join("\n").replace(/\s+$/, "");
        const command = session.currentCommand || (session.active ? getCurrentCommand() : "");
        const completedRun = {
          command,
          output,
          exitCode,
          at: Date.now(),
        };
        session.lastCompletedRun = completedRun;
        /* Pilot listens to this exact PTY completion rather than polling the
           active terminal. It remains correct when the user changes focus
           while an observed command is still running. */
        publishTerminalCommandRun({
          ...completedRun,
          terminalPtyId: session.ptyId,
          cwd: session.cwd,
        });
        /* The AI picker reflects the focused terminal, not output from a tab
           that happens to finish in the background. The per-leaf strips below
           still receive every completion. */
        if (session.active) recordCommandRun(completedRun);
        if (command.trim()) {
          session.callbacks.onCommandComplete?.({
            command,
            cwd: session.cwd,
            exitCode,
            at: completedRun.at,
          });
        }
        completeTask(session.leafId, {
          command,
          cwd: session.cwd,
          exitCode,
          at: completedRun.at,
        });
        /* Per-pane failure state for the Command Failure Assistant. Only a
           completed command with a real non-zero exit opens the strip — a
           successful next command (or a new command, below) retires it. */
        if (exitCode != null && exitCode !== 0) {
          recordFailure(session.leafId, { command, output, exitCode, cwd: session.cwd });
          clearNextSteps(session.leafId);
        } else if (exitCode === 0) {
          clearFailure(session.leafId);
          recordSensitiveOutput(session.leafId, { command, output, at: completedRun.at });
          recordGitActivity(session.leafId, { command, cwd: session.cwd, exitCode, at: completedRun.at });
          if (!session.isRemoteShell) {
            recordPorts(session.leafId, {
              command,
              urls: extractLocalDevUrls(command, output),
              at: completedRun.at,
            });
          }
          recordNextSteps(session.leafId, {
            command,
            output,
            exitCode,
            cwd: session.cwd,
            at: completedRun.at,
          });
        } else {
          clearNextSteps(session.leafId);
        }
        /* Timeline: the command and its outcome — never its output. */
        if (command.trim()) {
          const safeCommand = safeTimelineCommand(command);
          const durationMs = Date.now() - (session.commandStartedAt || getCommandStartTime());
          const workspaceRoot = getWorkspaceRoot();
          const recorded = recordTimelineEvent(
            exitCode != null && exitCode !== 0 ? "command_failed" : "command",
            exitCode != null && exitCode !== 0
              ? `${safeCommand.display} failed (exit ${exitCode})`
              : `Ran ${safeCommand.display}`,
            {
              exitCode,
              cwd: session.cwd,
              terminalSessionId: session.workflowSessionId,
              ...(safeCommand.command ? { command: safeCommand.command } : { redacted: true, sensitive: true }),
              ...(durationMs > 0 && durationMs < 86_400_000 ? { durationMs } : {}),
            },
            { workspaceRoot, sensitivity: safeCommand.sensitive ? 1 : 0 },
          );
          if (exitCode === 0 && safeCommand.command && workspaceRoot) {
            void recorded.then((saved) => {
              if (saved) void refreshWorkflowSuggestion(session.leafId, workspaceRoot);
            });
          }
        }
        session.cmdStartRow = null;
      }
      if (session.active) clearCurrentCommand();
      session.currentCommand = "";
      session.commandStartedAt = 0;
      session.liveOutputTail = "";
      // Interactive SSH/Mosh sessions are local commands that start a remote
      // shell. When the session ends, the shell is local again.
      session.isRemoteShell = false;
      session.remoteTarget = null;
      if (session.active) setActiveRemoteTerminal({ isRemote: false });
    }
    if (data.startsWith("C")) {
      const b = term.buffer.active;
      session.cmdStartRow = b.baseY + b.cursorY;
      session.liveOutputTail = "";
      if (!session.commandStartedAt) session.commandStartedAt = Date.now();
      startTask(session.leafId, {
        command: session.currentCommand || (session.active ? getCurrentCommand() : ""),
        cwd: session.cwd,
        at: session.commandStartedAt,
      });
      if (session.active) markCommandStart();
    }
    return true;
  });

  term.parser.registerOscHandler(778, (data) => {
    if (!data.startsWith("husk;cmd;")) return true;
    const cmd = data.slice("husk;cmd;".length).replace(/%3B/g, ";").trim();
    session.currentCommand = cmd;
    session.commandStartedAt = Date.now();
    recordEnvironmentWarning(session.leafId, {
      command: cmd,
      cwd: session.cwd,
      env: getEnvSignals(),
      at: session.commandStartedAt,
    });
    if (session.active) setCurrentCommand(cmd);
    // Treat an interactive ssh/mosh session as remote for the duration of the
    // command. The remote shell usually doesn't have Husk integration, so the
    // only reliable signal is the local command that started it.
    const remoteTarget = parseRemoteShellTarget(cmd);
    if (remoteTarget) {
      session.isRemoteShell = true;
      session.remoteTarget = remoteTarget;
      if (session.active) setActiveRemoteTerminal({ isRemote: true, host: remoteTarget });
    }
    return true;
  });

  term.parser.registerOscHandler(777, (data) => {
    const cmd = parseBridgeOsc(data);
    if (!cmd) return true;
    if (cmd.kind === "remote") {
      session.isRemoteShell = cmd.isRemote;
      if (!cmd.isRemote) session.remoteTarget = null;
      if (session.active) setActiveRemoteTerminal({ isRemote: cmd.isRemote, ...(session.remoteTarget ? { host: session.remoteTarget } : {}) });
      return true;
    }
    dispatchBridge(cmd);
    return true;
  });

  // ── Key Handler ───────────────────────────────────────────────────────────
  term.attachCustomKeyEventHandler((e) => {
    // Let TerminalView handle autocomplete keys first
    const handled = session.callbacks.onKey?.(e);
    if (handled === false) return false;

    if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      session.searchOpen = true;
      if (session.active) setActiveTerminalSearchOpener(() => { session.searchOpen = true; });
      return false;
    }
    if (e.type === "keydown" && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r") {
      // In SSH sessions, let the remote shell handle Ctrl+R (fzf / reverse-i-search).
      if (session.isRemoteShell) {
        console.log("[HUSK] Ctrl+R passed through to remote shell");
        return true;
      }
      console.log("[HUSK] Ctrl+R intercepted, opening Husk history panel");
      e.preventDefault();
      e.stopPropagation();
      // Cancel any running process (Ctrl+C) and fzf menu (Ctrl+G) without
      // clearing the screen — we want the terminal content to stay visible.
      if (session.ptyId != null) {
        void invoke("pty_write", { id: session.ptyId, data: "\x03\x07" });
      }
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

    // Best-effort husk command scanning in PTY output (remote hosts without integration)
    const HUSK_CMD_RE = /husk\s+(cp|open|preview|notify|diff)\s+(.+?)(?:\r?\n|$)/;

    session.unlisteners.push(
      await listen<number[]>(`pty://data/${id}`, (e) => {
        const data = new Uint8Array(e.payload);
        const text = new TextDecoder().decode(data);

        // Write to terminal immediately — xterm.js handles ANSI sequences
        // and progress bars correctly when fed in real-time
        term.write(text);
        emitTerminalOutput(leafId, text);

        /* Dev servers commonly keep the foreground command running forever,
           so waiting for OSC 133 D would never surface their local URL. Keep a
           small per-PTY sample and only recognise explicit local endpoints. */
        if (!session.isRemoteShell) {
          session.liveOutputTail = `${session.liveOutputTail}${text}`.slice(-8_192);
          const command = session.currentCommand || (session.active ? getCurrentCommand() : "");
          recordPorts(session.leafId, {
            command,
            urls: extractLocalDevUrls(command, session.liveOutputTail),
          });
        }

        // Scan for husk commands in the incoming text (not buffered)
        // This is best-effort: husk commands typically emit on their own line
        let match: RegExpMatchArray | null;
        const scanText = text;
        while ((match = scanText.match(HUSK_CMD_RE)) !== null) {
          const [, verb, rest] = match;
          const payload = `husk;${verb};${rest.trim()}`;
          const cmd = parseBridgeOsc(payload);
          if (cmd && session.active) {
            dispatchBridge(cmd);
          }
          // Only process first match per chunk to avoid loops
          break;
        }
      }),
    );
    session.unlisteners.push(
      await listen(`pty://exit/${id}`, () => {
        term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
        emitTerminalOutput(leafId, "\n[process exited]\n");
      }),
    );

    // Data handler
    session.typingTimer = 0;
    term.onData((data: string) => {
      const out = interceptTerminalInput(data);
      if (out === null) return;
      void invoke("pty_write", { id, data: out });
      /* Typing at the prompt again means the user has moved on — the failure
         strip collapses to its tiny indicator instead of holding a row. */
      collapseFailure(leafId);
      collapseNextSteps(leafId);
      clearGitActivity(leafId);
      clearEnvironmentWarning(leafId);
      if (session.active) {
        setTerminalTyping(true);
        window.clearTimeout(session.typingTimer);
        session.typingTimer = window.setTimeout(() => setTerminalTyping(false), 400);
      }
      // Trigger autocomplete check
      session.callbacks.onData?.();
    });

    // ResizeObserver settles the visual fit first. Mirror that exact grid to
    // the PTY immediately so shell prompts never redraw against stale columns.
    term.onResize(({ cols, rows }) => {
      if (cols === session.lastCols && rows === session.lastRows) return;
      session.lastCols = cols;
      session.lastRows = rows;
      queuePtyResize(session, cols, rows);
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
    term.options.fontWeight = p.terminalBoldFont ? "bold" : "normal";
    term.options.fontWeightBold = p.terminalBoldFont ? "900" : "bold";
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
      fitAttachedSession(session);
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
  fitAttachedSession(session);
  session.screenEl = container.querySelector(".xterm-screen") as HTMLElement | null;

  const doFit = () => {
    if (!session.term || !container.clientWidth || !container.clientHeight) return;
    try {
      const width = container.clientWidth;
      const height = container.clientHeight;
      // Ignore sub-pixel / duplicate resize events. Moving a window can fire
      // ResizeObserver callbacks even when the container size hasn't changed.
      if (width === session.lastWidth && height === session.lastHeight) {
        return;
      }
      fitAttachedSession(session);
    } catch {}
  };

  session.resizeObserver = new ResizeObserver(() => {
    window.clearTimeout(session.resizeTimer);
    // One trailing fit keeps the xterm grid and native PTY synchronized without
    // sending SIGWINCH for every pixel while a divider is being dragged.
    session.resizeTimer = window.setTimeout(() => {
      session.resizeTimer = 0;
      doFit();
    }, 180);
  });
  session.resizeObserver.observe(container);

  session.lastCols = session.term.cols;
  session.lastRows = session.term.rows;
  session.lastWidth = container.clientWidth;
  session.lastHeight = container.clientHeight;
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
  session.resizeTimer = 0;

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
    fitAttachedSession(session);
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
    setActiveRemoteTerminal({ isRemote: session.isRemoteShell, ...(session.remoteTarget ? { host: session.remoteTarget } : {}) });
    setPromptPosition(session.promptPosition);
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

    setActiveTerminalDraftReader(() => readPromptDraft(session));

    setActiveTerminalRunner((cmd: string) => {
      /* Never append a Run/Pilot command to a draft that exists at this prompt.
         The caller keeps the command available to copy and the user keeps their
         own in-progress input intact. */
      if (readPromptDraft(session)) return false;
      if (session.ptyId == null) return false;
      void invoke("pty_write", { id: session.ptyId, data: `${cmd}\r` });
      session.term.focus();
      return true;
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
      /* baseY + cursorY, not cursorY. cursorY is relative to the top of the
         viewport, while getLine() indexes the whole buffer including
         scrollback — so as soon as anything scrolled, this read some unrelated
         line from the top of the history and `/ai ` was never found. It only
         ever worked in a terminal that had not scrolled yet. */
      return buf.getLine(buf.baseY + buf.cursorY)?.translateToString(true) ?? "";
    });

    setAiPtyWriterInput((data: string) => {
      if (session.ptyId != null) void invoke("pty_write", { id: session.ptyId, data });
    });

    setFocusTerminalFn(() => session.term.focus());

    if (session.cwd) {
      setActiveTerminalCwd(session.cwd);
      if (!session.isRemoteShell) syncWorkspaceRootToCwd(session.cwd);
    }
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
    getLastCommandRun: () => session.lastCompletedRun ? { ...session.lastCompletedRun } : null,
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
    resize: () => fitAttachedSession(session),
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
  session.resizeTimer = 0;
  window.clearTimeout(session.typingTimer);

  for (const un of session.unlisteners) un();
  session.unlisteners = [];

  if (session.ptyId != null) {
    void invoke("pty_kill", { id: session.ptyId });
  }

  session.prefsUnsub?.();
  session.term.dispose();
  sessions.delete(leafId);
  outputListeners.delete(leafId);
  logsOpeners.delete(leafId);
  clearFailure(leafId);

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
