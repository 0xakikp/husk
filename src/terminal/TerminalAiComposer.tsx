import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  ComputerTerminal02Icon,
  PlusSignIcon,
  CommandIcon,
  FullScreenIcon,
  ArrowDownIcon,
  MessageMultiple02Icon,
  VoiceIcon,
  AttachmentSquareIcon,
  StopIcon,
  Copy01Icon,
  TickDouble01Icon,
  ArrowDown01Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { getPrefs, usePrefs, setPrefs } from "../settings/preferences";
import { loadConfig, getKey, useConfig } from "../ai/store";
import { getProvider } from "../ai/providers";
import { ModelSwitcher } from "../ai/ModelSwitcher";
import { streamChat } from "../ai/client";
import type { Tool } from "ai";
import { getActiveAgent, useAgents, setActiveAgent } from "../ai/agents";
import {
  getActiveTerminalCwd,
  isCommandRunning,
  readActiveTerminal,
  runInActiveTerminal,
  getRecentCommandRuns,
  getPendingRunAttachment,
  useActiveTerminalCwd,
  type CommandRun,
} from "../ai/terminalContext";
import { AppliedEditsActivity, PendingEditsReview } from "../ai/PendingEditsReview";
import { addPendingEdit, applyPendingEdit, removePendingEdit } from "../ai/pendingEdits";
import { parseSubscriptionEditProposals } from "../ai/subscriptionEdits";
import { canAutoApplySubscriptionEdits } from "../ai/subscriptionAutoApplySafety";
import {
  clearSubscriptionAutoApply,
  setSubscriptionAutoApply,
  useSubscriptionAutoApply,
} from "../ai/subscriptionAutoApply";
import { getTerminalContextSize } from "../ai/useTerminalContextSize";
import { getProjectMemory } from "../ai/projectMemory";
import { isEnvDestructive, protectedTargets } from "./envSignals";
import { recordTimelineEvent } from "../timeline/store";
import { buildHuskAssistantContext } from "../ai/huskContext";
import { ContextInspector } from "../ai/ContextInspector";
import {
  byteLength,
  budgetBytes,
  fitWithinBudget,
  formatKb,
  itemToRequestBlock,
  scanForSecrets,
  totalBytes,
  type AiContextItem,
} from "../ai/contextItems";
import { registerComposerToggle, registerComposerOpen, registerComposerSend } from "../ai/bubbleStore";
import { getEditorFile, getEditorSelection } from "../ai/editorStore";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile, readFileBase64, readFileScoped } from "../fs";
import { buildMcpTools } from "../mcp/tools";
import { buildBuiltinTools, mergeTools } from "../ai/builtinTools";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "../toast";
import { getTerminalRunDecision } from "./commandRun";
import { useWorkspaceRoot } from "../workspace/store";
import {
  isPathInWorkspace,
  normalizeWorkspacePath,
  workspaceDisplayName,
} from "../ai/workspaceScope";
import { parseWorkspaceFileReference } from "../ai/fileReferences";
import {
  AiMessage,
  type AiReplyTrace,
  getSession,
  updateSession,
  subscribeSessions,
  setActiveSessionId,
  ensureSession,
  isTabSessionId,
} from "../ai/sessionStore";
import "./TerminalAiComposer.css";

interface SpeechRecognitionEventLike {
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [i: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

interface CodeBlock {
  lang: string;
  code: string;
}

interface DiffBlockType {
  fileName?: string;
  lines: { kind: "add" | "del" | "ctx"; text: string }[];
}

interface FileTreeNode {
  name: string;
  children?: FileTreeNode[];
}

function getMessageAccentClass(color?: string) {
  return color ? `composer-message-accent-${color}` : "";
}

function parseCodeBlocks(text: string): CodeBlock[] {
  const blocks: CodeBlock[] = [];
  const regex = /```([\w-]*)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    /* An omitted fence language is code to copy and inspect, not an implicit
       shell command. Direct Run is intentionally opt-in via sh/bash/zsh. */
    const lang = (match[1] || "").toLowerCase();
    /* Subscription edit fences are machine-readable review proposals, not
       source code to copy or run. PendingEditsReview renders their diff. */
    if (lang !== "husk-edit") blocks.push({ lang, code: match[2].trim() });
  }
  return blocks;
}

function stripCodeBlocks(text: string): string {
  return text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, "").trim();
}

function renderInline(text: string, workspaceRoot?: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(regex)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const tok = m[0];
    if (tok.startsWith("**")) {
      nodes.push(<strong key={key++} className="wb-md-bold">{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith("`")) {
      const value = tok.slice(1, -1);
      const ref = parseWorkspaceFileReference(value);
      const root = normalizeWorkspacePath(workspaceRoot);
      if (ref && root) {
        const path = `${root}/${ref.relativePath}`;
        nodes.push(
          <button
            key={key++}
            type="button"
            className="wb-inline-code wb-file-ref"
            title={`Open ${ref.relativePath}${ref.line ? ` at line ${ref.line}` : ""}`}
            onClick={() => window.dispatchEvent(new CustomEvent("husk:open-ai-file", { detail: { path, line: ref.line } }))}
          >
            {value}
          </button>,
        );
      } else {
        nodes.push(<code key={key++} className="wb-inline-code">{value}</code>);
      }
    } else {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MarkdownText({ text, workspaceRoot }: { text: string; workspaceRoot?: string }) {
  const lines = text.split("\n");
  return (
    <div className="wb-md">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        const bullet = trimmed.match(/^[-*]\s+(.*)$/);
        const numbered = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="wb-md-li">
              <span className="wb-md-marker">•</span>
              <span className="wb-md-li-text">{renderInline(bullet[1], workspaceRoot)}</span>
            </div>
          );
        }
        if (numbered) {
          return (
            <div key={i} className="wb-md-li">
              <span className="wb-md-marker">{numbered[1]}.</span>
              <span className="wb-md-li-text">{renderInline(numbered[2], workspaceRoot)}</span>
            </div>
          );
        }
        if (!trimmed) return <div key={i} className="wb-md-gap" />;
        return (
          <div key={i} className="wb-md-p">
            {renderInline(line, workspaceRoot)}
          </div>
        );
      })}
    </div>
  );
}

/* Keep lengthy explanations readable without hiding the useful parts of a
   response: code, diffs and file trees still render in full below. We only
   fold prose at a paragraph boundary, which avoids cutting a Markdown list or
   sentence in half. */
function CollapsibleMarkdownText({ text, workspaceRoot }: { text: string; workspaceRoot?: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split("\n");
  const shouldCollapse = text.length > 1_400 || lines.length > 14;

  const collapsed = useMemo(() => {
    if (!shouldCollapse) return text;
    const candidate = lines.slice(0, 12).join("\n");
    const paragraphBreak = candidate.lastIndexOf("\n\n");
    return paragraphBreak > 80 ? candidate.slice(0, paragraphBreak) : candidate;
  }, [lines, shouldCollapse, text]);

  if (!shouldCollapse) return <MarkdownText text={text} workspaceRoot={workspaceRoot} />;

  return (
    <div className="msg-prose">
      <MarkdownText text={expanded ? text : collapsed} workspaceRoot={workspaceRoot} />
      <button
        type="button"
        className="msg-details-toggle"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "collapse answer" : "show full answer"}
      </button>
    </div>
  );
}

function AiReplyTraceRow({ trace }: { trace: AiReplyTrace }) {
  const [expanded, setExpanded] = useState(false);
  const completedTools = trace.tools.filter((tool) => tool.state === "complete");
  const toolSummary = trace.tools.length
    ? `${completedTools.length === trace.tools.length ? "tools complete" : "tools running"} · ${trace.tools.length}`
    : trace.mode === "subscription"
      ? trace.workspaceAutoApply
        ? "auto apply"
        : trace.workspaceEditAccess
        ? "review proposals"
        : "read-only"
      : "no tools used";
  return (
    <div className="ai-reply-trace">
      <button
        type="button"
        className="ai-reply-trace-summary"
        onClick={() => setExpanded((value) => !value)}
        title="Show the model, attached context, and tools used for this answer"
      >
        <span className="ai-reply-trace-dot" aria-hidden="true">●</span>
        <span>{trace.providerLabel}</span>
        <span className="ai-reply-trace-sep">·</span>
        <span className="truncate">{trace.modelLabel}</span>
        <span className="ai-reply-trace-sep">·</span>
        <span>{trace.mode === "subscription" ? "subscription" : "API"}</span>
        <span className="ai-reply-trace-sep">·</span>
        <span>{trace.context.length} context</span>
        <span className="ai-reply-trace-sep">·</span>
        <span>{toolSummary}</span>
        <span className="ai-reply-trace-disclosure">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded && (
        <div className="ai-reply-trace-details">
          <div className="ai-reply-trace-detail-row">
            <span>model</span>
            <strong>{trace.providerLabel} · {trace.modelLabel}</strong>
          </div>
          <div className="ai-reply-trace-detail-row">
            <span>access</span>
            <strong>{trace.mode === "subscription"
              ? trace.workspaceAutoApply
                ? "subscription · auto-apply enabled"
                : trace.workspaceEditAccess
                  ? "subscription · reviewable proposals"
                  : "subscription · read-only"
              : "API-backed · tools available"}</strong>
          </div>
          <div className="ai-reply-trace-detail-row">
            <span>workspace</span>
            <strong>{trace.workspacePath || "general chat · no workspace selected"}</strong>
          </div>
          <div className="ai-reply-trace-detail-row">
            <span>context</span>
            <strong>{trace.context.length ? trace.context.map((item) => `${item.label} (${formatKb(item.bytes)})`).join(" · ") : "message only"}</strong>
          </div>
          {trace.tools.length > 0 && (
            <div className="ai-reply-trace-detail-row">
              <span>tools</span>
              <strong>{trace.tools.map((tool) => `${tool.state === "complete" ? "✓" : "…"} ${tool.name}`).join(" · ")}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingIndicator() {
  return (
    <span className="composer-loading">
      <span className="composer-loading-dots">
        <span />
        <span />
        <span />
      </span>
      <span>thinking</span>
    </span>
  );
}

function parseDiffBlocks(text: string): DiffBlockType[] {
  const blocks: DiffBlockType[] = [];
  const regex = /```diff\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1];
    const lines = raw.split("\n").map((line) => {
      if (line.startsWith("+")) return { kind: "add" as const, text: line };
      if (line.startsWith("-")) return { kind: "del" as const, text: line };
      return { kind: "ctx" as const, text: line };
    });
    blocks.push({ lines });
  }
  return blocks;
}

function parseFileTree(text: string): FileTreeNode[] | null {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("├──") || l.trim().startsWith("└──") || l.trim().startsWith("│"));
  if (lines.length < 2) return null;
  return lines.map((line) => {
    const cleaned = line.replace(/^[│\s]*[├└]── /, "").trim();
    return { name: cleaned };
  });
}

export function tabSessionId(tabId: number): string {
  return `tab-${tabId}`;
}

export function tabSessionName(sessionId: string): string {
  if (!isTabSessionId(sessionId)) return sessionId;
  const tabId = parseInt(sessionId.slice(4), 10);
  return isNaN(tabId) ? sessionId : `Terminal ${tabId}`;
}

const DANGEROUS_PATTERNS = [
  /\brm\s+-rf\s+\//i,
  /\brm\s+(-[rfia]+\s+)?\//i,
  /\bdd\s+if=/i,
  /\bmkfs\./i,
  /\bsudo\s+/i,
  /\bsu\s+-/i,
  /\bchmod\s+-R\s+777\b/i,
  />\s*\/dev\/null\s+.*\b(sda|disk0|rdisk0)\b/i,
  /\bcurl\s+.*\|\s*(sh|bash|zsh|csh|tcsh|fish)\b/i,
  /\bwget\s+.*-O\s*-\s*\|\s*(sh|bash|zsh|csh|tcsh|fish)\b/i,
];

function isDangerousCommand(cmd: string): boolean {
  const trimmed = cmd.trim();
  return DANGEROUS_PATTERNS.some((p) => p.test(trimmed));
}

export function TerminalAiComposer({
  sessionId,
  onOpenInAiTab,
  variant = "docked",
  dock = "bottom",
  registerToggle = true,
  registerOpen = true,
  registerSend = false,
  className,
}: {
  sessionId: string;
  onOpenInAiTab?: () => void;
  variant?: "docked" | "full";
  dock?: "bottom" | "right" | "left";
  registerToggle?: boolean;
  registerOpen?: boolean;
  registerSend?: boolean;
  className?: string;
}) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; content: string; isImage?: boolean }[]>([]);
  const [previewChipId, setPreviewChipId] = useState<string | null>(null);
  /* A specific command's output, chosen from history. Far more precise than the
     whole-scrollback chip, which mixes unrelated commands together. */
  const [attachedRuns, setAttachedRuns] = useState<CommandRun[]>([]);
  const attachedRunsSessionRef = useRef(sessionId);
  const [runPickerOpen, setRunPickerOpen] = useState(false);
  const [workspaceScopeOpen, setWorkspaceScopeOpen] = useState(false);
  const [dismissedWorkspaceChange, setDismissedWorkspaceChange] = useState<string | null>(null);

  const prefs = usePrefs();
  const agents = useAgents();
  const activeAgent = getActiveAgent();
  const activeAgentName = activeAgent?.name ?? "Husk AI";
  const activeAgentIcon = activeAgent?.icon ?? "✦";
  const messageAccentClass = getMessageAccentClass(activeAgent?.color);
  const [open, setOpen] = useState(variant === "full");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pendingRun, setPendingRun] = useState<{ command: string; productionTarget: string | null } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<(textOverride?: string, opts?: { allowOverBudget?: boolean; allowSensitive?: boolean; fitToBudget?: boolean }) => Promise<void>>(async () => {});
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const workspaceScopeRef = useRef<HTMLDivElement>(null);
  const slashPaletteRef = useRef<HTMLDivElement>(null);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [codeTabMap, setCodeTabMap] = useState<Record<number, number>>({});
  const activeWorkspaceRoot = useWorkspaceRoot();
  const activeTerminalCwd = useActiveTerminalCwd();

  // Right-dock (side panel) state
  /* Docked to either side. Everything about a side dock is shared except which
     edge the resize handle sits on, which way the shadow falls, and the sign of
     the resize delta — so the layout reads `dockSide` and only those three read
     `dockLeft`. */
  const dockLeft = dock === "left" && variant === "docked";
  const dockRight = dock === "right" && variant === "docked";
  const dockSide = dockLeft || dockRight;
  const sideDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const sideSignRef = useRef(1);
  const startWidthRef = useRef(0);
  const [sideWidth, setSideWidth] = useState(prefs.aiComposerSideWidth ?? 380);
  const sideWidthRef = useRef(sideWidth);

  const session = getSession(sessionId);
  const messages = session.messages;
  const input = session.input;
  const workspacePath = normalizeWorkspacePath(session.workspacePath);
  const subscriptionAutoApply = useSubscriptionAutoApply(sessionId, workspacePath);
  const currentWorkspacePath = normalizeWorkspacePath(activeWorkspaceRoot);
  const workspaceChangeKey = workspacePath && currentWorkspacePath
    ? `${workspacePath}\n${currentWorkspacePath}`
    : "";
  const terminalWorkspaceMoved =
    variant === "docked" &&
    isTabSessionId(sessionId) &&
    !!workspacePath &&
    !!currentWorkspacePath &&
    !!activeTerminalCwd &&
    !isPathInWorkspace(activeTerminalCwd, workspacePath) &&
    dismissedWorkspaceChange !== workspaceChangeKey;

  const setChatWorkspace = useCallback((path: string | null) => {
    const nextPath = normalizeWorkspacePath(path);
    const currentPath = normalizeWorkspacePath(getSession(sessionId).workspacePath);
    updateSession(sessionId, (current) => ({
      ...current,
      workspacePath: nextPath || undefined,
      /* Approval belongs to both this conversation and this exact folder. A
         different folder always requires fresh consent. */
      workspaceEditAccess:
        nextPath && normalizeWorkspacePath(current.workspacePath) === nextPath
          ? current.workspaceEditAccess
          : false,
    }));
    if (currentPath !== nextPath) clearSubscriptionAutoApply(sessionId);
    setWorkspaceScopeOpen(false);
    setDismissedWorkspaceChange(null);
  }, [sessionId]);

  const setSubscriptionEditAccess = useCallback((enabled: boolean) => {
    updateSession(sessionId, (current) => ({
      ...current,
      workspaceEditAccess: Boolean(enabled && normalizeWorkspacePath(current.workspacePath)),
    }));
    if (!enabled) clearSubscriptionAutoApply(sessionId);
  }, [sessionId]);

  const setSubscriptionAutoApplyEnabled = useCallback((enabled: boolean) => {
    const current = getSession(sessionId);
    const root = normalizeWorkspacePath(current.workspacePath);
    setSubscriptionAutoApply(
      sessionId,
      root,
      Boolean(enabled && root && current.workspaceEditAccess),
    );
  }, [sessionId]);

  const chooseChatWorkspace = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") setChatWorkspace(selected);
  }, [setChatWorkspace]);

  const setInput = (value: string) => {
    updateSession(sessionId, (s) => ({ ...s, input: value }));
  };

  /* A recovery prompt can be longer than a terminal command. Keep it readable
     when it is prefilled from a failure strip, and grow naturally while the
     user types. Once it reaches a sensible size, the field itself scrolls so
     the composer never takes over the terminal. */
  const resizeInput = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const maxHeight = variant === "full" ? 160 : 120;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [variant]);

  useLayoutEffect(() => {
    resizeInput();
  }, [input, open, resizeInput]);

  const setMessages = (updater: (prev: AiMessage[]) => AiMessage[]) => {
    updateSession(sessionId, (s) => ({ ...s, messages: updater(s.messages) }));
  };

  const newSession = useCallback(() => {
    updateSession(sessionId, () => ({ ...getSession(sessionId), messages: [], input: "" }));
    const defaults = getPrefs();
    setIncludeFile(defaults.aiDefaultIncludeFile);
    setIncludeSelection(defaults.aiDefaultIncludeSelection);
    setIncludeTerminal(defaults.aiDefaultIncludeTerminal);
    setExcludeProjectMemory(false);
    setBudgetPrompt(null);
    setSensitivePrompt(null);
  }, [sessionId]);

  const handleFileUpload = useCallback(async () => {
    try {
      const path = await openDialog({ multiple: false, directory: false });
      if (!path || typeof path !== "string") return;
      const fileName = path.split("/").pop() || path;
      const isImage = /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(fileName);
      let content = "";
      try {
        if (isImage) {
          const b64 = await readFileBase64(path);
          content = `[Attached image: ${fileName}]\n\n![${fileName}](data:image/${fileName.split(".").pop()};base64,${b64})`;
        } else {
          const text = await readFile(path);
          content = `[Attached file: ${fileName}]\n\`\`\`\n${text}\n\`\`\``;
        }
      } catch (e) {
        content = `[Failed to read file: ${fileName}]`;
      }
      const current = getSession(sessionId).input;
      setInput(current ? (current + "\n\n" + content).trim() : content);
    } catch (e) {
      console.error("File upload failed", e);
    }
  }, [sessionId]);

  // Context items — the single normalized list every surface reads from.
  // Chips, the Context Inspector and the request builder all derive from this,
  // so what the user reviews is literally what gets sent.
  const currentFile = useMemo(() => getEditorFile(), [tick]);
  const selection = useMemo(() => getEditorSelection(), [tick]);
  const fileName = currentFile ? currentFile.split("/").pop() : null;
  const [includeFile, setIncludeFile] = useState(() => prefs.aiDefaultIncludeFile);
  const [includeSelection, setIncludeSelection] = useState(() => prefs.aiDefaultIncludeSelection);
  const [includeTerminal, setIncludeTerminal] = useState(() => prefs.aiDefaultIncludeTerminal);
  const [excludeProjectMemory, setExcludeProjectMemory] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [budgetPrompt, setBudgetPrompt] = useState<{ total: number } | null>(null);
  const [sensitivePrompt, setSensitivePrompt] = useState<AiContextItem[] | null>(null);
  const [fileCache, setFileCache] = useState<{ path: string; content: string } | null>(null);

  const budgetKb = prefs.aiContextBudgetKb || 32;

  /* Cache the open file's content so chips and the Inspector can show real
     bytes and a preview without a disk read on every render. The send path
     re-reads, so a stale cache never decides what the model sees. */
  useEffect(() => {
    let cancelled = false;
    if (!currentFile || !includeFile || !workspacePath || !isPathInWorkspace(currentFile, workspacePath)) {
      setFileCache(null);
      return;
    }
    readFileScoped(currentFile, workspacePath)
      .then((content) => { if (!cancelled) setFileCache({ path: currentFile, content }); })
      .catch(() => { if (!cancelled) setFileCache(null); });
    return () => { cancelled = true; };
  }, [currentFile, includeFile, workspacePath]);

  const contextItems = useMemo<AiContextItem[]>(() => {
    const items: AiContextItem[] = [];
    const mk = (
      partial: Omit<AiContextItem, "bytes" | "sensitive" | "sensitiveReasons">,
    ): AiContextItem => {
      const reasons = scanForSecrets(`${partial.label} ${partial.source}`, partial.preview);
      return {
        ...partial,
        bytes: byteLength(partial.preview),
        sensitive: reasons.length > 0,
        sensitiveReasons: reasons,
      };
    };
    const fileIsInScope =
      !!workspacePath &&
      isPathInWorkspace(currentFile, workspacePath) &&
      fileCache?.path === currentFile;
    const terminalMatchesScope =
      !workspacePath || isPathInWorkspace(activeTerminalCwd, workspacePath);
    if (workspacePath) {
      items.push(mk({
        id: "workspace",
        kind: "workspace",
        icon: "⌂",
        label: `workspace · ${workspaceDisplayName(workspacePath)}`,
        source: workspacePath,
        preview: workspacePath,
        removable: false,
      }));
    }
    /* The selected workspace is a boundary, not just a hint. An editor file
       from another project is not silently attached to this conversation. */
    if (currentFile && includeFile && fileIsInScope) {
      const content = fileCache?.path === currentFile ? fileCache.content : "";
      items.push(mk({
        id: "file",
        kind: "editor-file",
        icon: "📄",
        label: fileName || currentFile,
        source: currentFile,
        preview: content,
        removable: true,
      }));
    }
    if (selection && includeSelection && fileIsInScope) {
      items.push(mk({
        id: "selection",
        kind: "selection",
        icon: "📋",
        label: `selection:${selection.startLine}-${selection.endLine}`,
        source: `lines ${selection.startLine}-${selection.endLine}`,
        preview: selection.text,
        removable: true,
      }));
    }
    for (const run of attachedRuns) {
      const label = run.command.trim() || "(command)";
      items.push(mk({
        id: `run:${run.at}`,
        kind: "command-run",
        icon: "▶",
        /* A command's output is evidence, not a generic attachment. Keep its
           origin and outcome visible in the chip so a user can spot it before
           sending, without needing to open the inspector. */
        label: `run · ${label.length > 22 ? `${label.slice(0, 21)}…` : label} · exit ${run.exitCode ?? "?"}`,
        source: run.command || "(command)",
        preview: `$ ${run.command}\n${run.output}`,
        removable: true,
      }));
    }
    if (includeTerminal && terminalMatchesScope) {
      /* Show the size. Terminal scrollback routinely contains echoed API keys,
         kubectl output, connection strings and internal hostnames, and all of it
         leaves the machine on send — so how much is going is worth stating, and
         the chip is clickable to see exactly what. */
      const term = readActiveTerminal();
      const { kb, capped } = getTerminalContextSize();
      items.push(mk({
        id: "terminal",
        kind: "terminal",
        icon: "🖥️",
        label: `terminal output · ${kb} KB${capped ? " (tail)" : ""}`,
        source: "active terminal scrollback",
        preview: term,
        removable: true,
      }));
    }
    attachedFiles.forEach((f, idx) => {
      items.push(mk({
        id: `attach:${idx}`,
        kind: "file",
        icon: f.isImage ? "🖼️" : "📎",
        label: f.name,
        source: f.name,
        preview: f.content,
        removable: true,
        isImage: f.isImage,
      }));
    });
    const projectNote = getProjectMemory(workspacePath);
    if (projectNote && !excludeProjectMemory) {
      items.push(mk({
        id: "project-memory",
        kind: "project-memory",
        icon: "🗂️",
        label: "project memory",
        source: "Settings → Agents → project memory",
        preview: projectNote,
        removable: true,
      }));
    }
    /* Global instructions and personal memory are assembled inside
       buildHuskAssistantContext — they are listed here for review only, so
       they are informational (fixed), never appended twice. */
    if (prefs.aiGlobalInstructions.trim()) {
      items.push(mk({
        id: "instructions",
        kind: "instructions",
        icon: "📝",
        label: "global instructions",
        source: "Settings → Agents",
        preview: prefs.aiGlobalInstructions,
        removable: false,
      }));
    }
    if (prefs.aiPersonalMemory.trim()) {
      items.push(mk({
        id: "personal-memory",
        kind: "personal-memory",
        icon: "🧠",
        label: "personal memory",
        source: "Settings → Agents",
        preview: prefs.aiPersonalMemory,
        removable: false,
      }));
    }
    return items;
  }, [currentFile, fileName, fileCache, selection, includeFile, includeSelection, includeTerminal, attachedRuns, attachedFiles, excludeProjectMemory, prefs.aiGlobalInstructions, prefs.aiPersonalMemory, tick, workspacePath, activeTerminalCwd]);

  const removeContextItem = useCallback((id: string) => {
    if (id === "file") setIncludeFile(false);
    else if (id === "selection") setIncludeSelection(false);
    else if (id === "terminal") setIncludeTerminal(false);
    else if (id === "project-memory") setExcludeProjectMemory(true);
    else if (id.startsWith("run:")) {
      const at = Number(id.slice(4));
      setAttachedRuns((rs) => rs.filter((r) => r.at !== at));
    } else if (id.startsWith("attach:")) {
      const idx = Number(id.slice(7));
      setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
    }
  }, []);

  const clearAllContext = useCallback(() => {
    setIncludeFile(false);
    setIncludeSelection(false);
    setIncludeTerminal(false);
    setAttachedRuns([]);
    setAttachedFiles([]);
    setExcludeProjectMemory(true);
  }, []);

  /* Chips cover the per-request attachments; instructions/memory stay visible
     through the footer count and the Inspector instead of crowding the row. */
  const chipItems = contextItems.filter((i) => i.removable);

  const previewChip = contextItems.find((c) => c.id === previewChipId && c.preview);

  // Slash palette commands
  const slashCommands = useMemo(() => {
    const templates = prefs.aiPromptTemplates ?? [];
    const base = [
      { id: "/clear", label: "/clear", desc: "Clear context and start fresh", icon: "🧹", run: () => newSession() },
      { id: "/agent", label: "/agent", desc: "Switch AI agent", icon: "🤖", run: () => setAgentDropdownOpen(true) },
      { id: "/attach", label: "/attach", desc: "Attach a file", icon: "📎", run: () => handleFileUpload() },
      { id: "/output", label: "/output", desc: "Attach one command's output", icon: "▶", run: () => setRunPickerOpen(true) },
    ];
    templates.forEach((t) => {
      base.push({
        id: `/${t.label.toLowerCase()}`,
        label: `/${t.label.toLowerCase()}`,
        desc: t.prompt.slice(0, 55),
        icon: t.icon,
        run: () => setInput(t.prompt),
      });
    });
    agents.forEach((a) => {
      base.push({
        id: `/agent-${a.id}`,
        label: `/${a.name.toLowerCase()}`,
        desc: `Switch to ${a.name} agent`,
        icon: a.icon,
        run: () => setActiveAgent(a.id),
      });
    });
    return base;
  }, [prefs.aiPromptTemplates, agents, newSession, handleFileUpload]);

  const slashQuery = input.startsWith("/") ? input.slice(1).toLowerCase() : "";
  const filteredSlash = useMemo(() => {
    if (!slashQuery) return slashCommands;
    return slashCommands.filter((c) => c.label.toLowerCase().includes(slashQuery) || c.desc.toLowerCase().includes(slashQuery));
  }, [slashQuery, slashCommands]);

  useEffect(() => {
    if (input.startsWith("/")) {
      setSlashOpen(true);
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  }, [input]);

  // Auto-focus textarea when composer opens
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Close header and slash dropdowns when clicking outside.
  useEffect(() => {
    if (!agentDropdownOpen && !workspaceScopeOpen && !slashOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!agentDropdownRef.current?.contains(e.target as Node)) {
        setAgentDropdownOpen(false);
      }
      if (!workspaceScopeRef.current?.contains(e.target as Node)) {
        setWorkspaceScopeOpen(false);
      }
      if (!slashPaletteRef.current?.contains(e.target as Node)) {
        setSlashOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [agentDropdownOpen, workspaceScopeOpen, slashOpen]);

  // Ensure the session exists. A new terminal chat captures the resolved
  // project root once; historical conversations intentionally stay unscoped
  // until the user chooses a folder, rather than being rebound to today's cwd.
  useEffect(() => {
    if (isTabSessionId(sessionId)) {
      const tabId = parseInt(sessionId.slice(4), 10);
      const ensured = ensureSession(sessionId, {
        name: tabSessionName(sessionId),
        source: "terminal",
        tabId,
        workspacePath: currentWorkspacePath || undefined,
      });
      if (!ensured.workspacePath && ensured.messages.length === 0 && currentWorkspacePath) {
        updateSession(sessionId, (current) => ({ ...current, workspacePath: currentWorkspacePath }));
      }
    }
  }, [sessionId, currentWorkspacePath]);

  useEffect(() => {
    setDismissedWorkspaceChange(null);
  }, [workspaceChangeKey]);

  /* Command output belongs to the chat it was explicitly attached to. Without
     this reset, switching conversations in the full AI view could carry a
     failed command into an unrelated request. */
  useEffect(() => {
    if (attachedRunsSessionRef.current === sessionId) return;
    attachedRunsSessionRef.current = sessionId;
    setAttachedRuns([]);
  }, [sessionId]);

  useEffect(() => {
    if (!registerToggle) return;
    return registerComposerToggle(() => setOpen((v) => !v));
  }, []);

  useEffect(() => {
    if (!registerOpen) return;
    return registerComposerOpen((text) => {
      setOpen(true);
      /* The failure strip parks a failed command's output for attachment.
         Peek (not consume): several composers open at once and each dedupes
         by `at`; the strip clears the slot shortly after. */
      const pendingRun = getPendingRunAttachment();
      if (pendingRun) {
        setAttachedRuns((rs) => (rs.some((r) => r.at === pendingRun.at) ? rs : [...rs, pendingRun]));
      }
      if (text) {
        setInput(text);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    });
    /* sessionId in deps is load-bearing: the composer instance is reused
       across tab switches, and a stale registration would write the opened
       text into the PREVIOUS tab's session — invisible in the current one. */
  }, [sessionId, registerOpen]);

  useEffect(() => {
    if (!registerSend) return;
    return registerComposerSend((text) => {
      setOpen(true);
      setInput(text);
      setTimeout(() => {
        textareaRef.current?.focus();
        handleSendRef.current(text);
      }, 60);
    });
  }, [sessionId, registerSend]);

  useEffect(() => {
    return subscribeSessions(() => setTick((v) => v + 1));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, tick, busy, status]);

  const handleSend = useCallback(async (
    textOverride?: string,
    opts?: { allowOverBudget?: boolean; allowSensitive?: boolean; fitToBudget?: boolean },
  ) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;

    /* Context gates run before anything is cleared or sent. Husk never
       silently cuts context and never silently ships suspicious content —
       both require an explicit choice. */
    if (!opts?.allowOverBudget && !opts?.fitToBudget) {
      const total = totalBytes(contextItems);
      if (total > budgetBytes(budgetKb)) {
        setBudgetPrompt({ total });
        return;
      }
    }
    if (!opts?.allowSensitive) {
      const flagged = contextItems.filter((i) => i.sensitive);
      if (flagged.length > 0) {
        setSensitivePrompt(flagged);
        return;
      }
    }
    setBudgetPrompt(null);
    setSensitivePrompt(null);

    setInput("");
    setSlashOpen(false);
    setBusy(true);
    setStatus("💭 thinking…");
    abortRef.current = false;
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = new AbortController();

    const now = Date.now();
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: now }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true, timestamp: Date.now() }]);

    const cfg = loadConfig();
    const provider = getProvider(cfg.providerId);
    const apiKey = getKey(provider.id);
    const subscriptionEditAccess =
      provider.kind === "cli" && Boolean(session.workspaceEditAccess && workspacePath);
    const subscriptionAutoApplyActive = subscriptionEditAccess && subscriptionAutoApply;
    if (!provider.keyless && !apiKey) {
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: `⚠️ Set a ${provider.label} API key in Settings → Models first.` };
        return next;
      });
      setBusy(false);
      setStatus(null);
      return;
    }

    let tools: Record<string, Tool> = {};
    if (provider.kind !== "cli" && (prefs.aiFileToolsEnabled || prefs.aiMcpToolsEnabled)) {
      try {
        const mcpTools = prefs.aiMcpToolsEnabled ? await buildMcpTools().catch(() => ({})) : {};
        /* Built-in filesystem access requires a chat-selected root. MCP tools
           retain their own configured scopes and are deliberately not treated
           as local-file access. */
        const builtinTools = prefs.aiFileToolsEnabled && workspacePath
          ? buildBuiltinTools(sessionId, workspacePath)
          : {};
        tools = mergeTools(builtinTools, mcpTools);
      } catch (e) {
        if (import.meta.env.DEV) {
          console.warn("[AI] tool build failed", e);
        }
      }
    }

    const agent = getActiveAgent();
    const modelId = agent.model || cfg.model || provider.defaultModel;

    /* The request is assembled from the inspected item list — not from hidden
       ad-hoc sources. fitToBudget keeps only what fits; the user has already
       seen what was dropped in the budget prompt. */
    const sendItems = opts?.fitToBudget
      ? fitWithinBudget(contextItems, budgetKb).kept
      : [...contextItems];

    /* Re-read the open file at send time — the render-time cache can lag the
       latest save, and the model should see the file as it is now. */
    const fileIdx = sendItems.findIndex((i) => i.kind === "editor-file");
    if (fileIdx >= 0 && currentFile && workspacePath) {
      try {
        const content = await readFileScoped(currentFile, workspacePath);
        sendItems[fileIdx] = { ...sendItems[fileIdx], preview: content, bytes: byteLength(content) };
      } catch {
        sendItems[fileIdx] = { ...sendItems[fileIdx], preview: "(could not read file)" };
      }
    }

    /* Stored with the reply rather than derived from the current settings: a
       chat reopened next week should truthfully show the provider, context, and
       tools that were available when that specific answer was generated. */
    const replyTrace: AiReplyTrace = {
      providerLabel: provider.label,
      modelLabel: modelId,
      mode: provider.kind === "cli" ? "subscription" : "api",
      workspacePath: workspacePath || undefined,
      workspaceEditAccess: subscriptionEditAccess || undefined,
      workspaceAutoApply: subscriptionAutoApplyActive || undefined,
      context: sendItems.map((item) => ({ label: item.label, bytes: item.bytes })),
      tools: [],
    };
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last?.role === "assistant") next[next.length - 1] = { ...last, trace: replyTrace };
      return next;
    });

    let system =
      agent.systemPrompt +
      "\n\n" +
      buildHuskAssistantContext({
        agent,
        provider,
        model: modelId,
        workspacePath: workspacePath || undefined,
        subscriptionEditAccess,
        subscriptionAutoApply: subscriptionAutoApplyActive,
      }) +
      "\n\nIf you suggest a command the user may run, put one short command in an explicitly labelled `sh` code block. Put scripts and source code in their real language fence; do not label them `sh`. When referring to a file in the selected workspace, use a backticked relative path, optionally with `:line`, so the user can open it.";

    for (const item of sendItems) {
      system += itemToRequestBlock(item);
    }

    /* Timeline: AI request metadata only — provider, model and context size.
       The prompt and the reply are never recorded. */
    recordTimelineEvent("ai", `Asked ${agent.name || "Husk AI"} · ${provider.label} · ${modelId}`, {
      contextBytes: totalBytes(sendItems),
      contextItems: sendItems.length,
      mode: provider.kind === "cli" ? "subscription" : "api",
    });

    let assistantResponse = "";
    try {
      await streamChat(
        {
          provider,
          model: modelId,
          apiKey,
          baseURL: cfg.baseURL,
          workspacePath: workspacePath || undefined,
        },
        system,
        [...messages, { role: "user", content: text }],
        (delta) => {
          if (abortRef.current) return;
          assistantResponse += delta;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + delta };
            }
            return next;
          });
        },
        tools && Object.keys(tools).length > 0 ? tools : undefined,
        abortCtrlRef.current.signal,
        (statusText) => setStatus(statusText),
        (activity) => {
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last?.role !== "assistant" || !last.trace) return prev;
            const tools = [...last.trace.tools];
            const existing = tools.findIndex((tool) => tool.name === activity.name);
            if (existing >= 0) tools[existing] = activity;
            else tools.push(activity);
            next[next.length - 1] = { ...last, trace: { ...last.trace, tools } };
            return next;
          });
        },
      );
      if (subscriptionEditAccess && assistantResponse) {
        const parsed = parseSubscriptionEditProposals(assistantResponse, workspacePath);
        const queued = parsed.proposals.map((proposal) =>
          addPendingEdit(
            proposal.kind === "create"
              ? {
                  path: proposal.path,
                  search: "",
                  replace: proposal.content,
                  operation: "create",
                  sessionId,
                  workspaceRoot: workspacePath,
                }
              : {
                  path: proposal.path,
                  search: proposal.search,
                  replace: proposal.replace,
                  operation: "edit",
                  sessionId,
                  workspaceRoot: workspacePath,
                },
          )
        );
        const autoSafety = subscriptionAutoApplyActive && parsed.rejected === 0
          ? canAutoApplySubscriptionEdits(parsed.proposals)
          : {
              ok: false,
              reason: parsed.rejected > 0
                ? "the response also contained an invalid proposal"
                : "automatic edits are off",
            };

        if (subscriptionAutoApplyActive && autoSafety.ok) {
          let applied = 0;
          let failure: string | null = null;
          for (const edit of queued) {
            const result = await applyPendingEdit(edit);
            if (result.ok) {
              applied += 1;
              removePendingEdit(edit.id);
            } else {
              failure = `${result.path.split("/").pop() || result.path}: ${result.reason}`;
              break;
            }
          }
          if (applied > 0) {
            toast({
              title: `Auto-applied ${applied} workspace change${applied === 1 ? "" : "s"}`,
              message: "Each change is shown below and can be undone while unchanged.",
              variant: "success",
              duration: 4000,
            });
          }
          if (failure) {
            toast({
              title: "Auto-apply paused",
              message: `${failure}. Remaining proposals are ready for review.`,
              variant: "error",
              duration: 6000,
            });
          }
        }
        if (parsed.proposals.length > 0) {
          if (!subscriptionAutoApplyActive || !autoSafety.ok) {
            toast({
              title: `${parsed.proposals.length} edit proposal${parsed.proposals.length === 1 ? "" : "s"} ready to review`,
              message: subscriptionAutoApplyActive
                ? `Auto-apply skipped: ${autoSafety.reason}. Nothing has been written.`
                : "Nothing has been written yet.",
              variant: "info",
              duration: 4000,
            });
          }
        } else if (parsed.rejected > 0) {
          toast({
            title: "Ignored an invalid edit proposal",
            message: "Husk only accepts valid, workspace-relative review proposals.",
            variant: "error",
            duration: 4500,
          });
        }
      }
    } catch (e) {
      if (abortRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") {
          next[next.length - 1] = { ...last, content: last.content + `\n\n⚠️ ${msg}` };
        }
        return next;
      });
    } finally {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.streaming) {
          next[next.length - 1] = { ...last, streaming: false };
        }
        return next;
      });
      setBusy(false);
      setStatus(null);
      setAttachedFiles([]);
    }
  }, [input, busy, messages, sessionId, contextItems, budgetKb, currentFile, prefs.aiFileToolsEnabled, prefs.aiMcpToolsEnabled, workspacePath, session.workspaceEditAccess, subscriptionAutoApply]);

  const stop = useCallback(() => {
    abortRef.current = true;
    abortCtrlRef.current?.abort();
    setBusy(false);
    setStatus(null);
  }, []);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !panelRef.current || variant === "full") return;
      const delta = startYRef.current - e.clientY;
      const next = Math.min(
        Math.max(startHeightRef.current + delta, 120),
        window.innerHeight * 0.85,
      );
      setHeight(next);
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [variant]);

  // Side (right-dock) width resize
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!sideDraggingRef.current) return;
      const delta = (startXRef.current - e.clientX) * sideSignRef.current;
      const next = Math.min(620, Math.max(280, Math.round(startWidthRef.current + delta)));
      sideWidthRef.current = next;
      setSideWidth(next);
    };
    const onUp = () => {
      if (!sideDraggingRef.current) return;
      sideDraggingRef.current = false;
      setPrefs({ aiComposerSideWidth: sideWidthRef.current });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startSideResize = (e: React.MouseEvent) => {
    e.preventDefault();
    sideDraggingRef.current = true;
    // Left dock: the handle is on the panel's right edge, so dragging right
    // grows it — the opposite sign to a right dock.
    sideSignRef.current = dockLeft ? -1 : 1;
    startXRef.current = e.clientX;
    startWidthRef.current = panelRef.current?.clientWidth ?? sideWidthRef.current;
  };

  const handleClose = () => {
    abortRef.current = true;
    abortCtrlRef.current?.abort();
    setOpen(false);
    setBusy(false);
    setStatus(null);
  };

  const sendCommandToTerminal = (command: string): boolean => {
    const cmd = command.trim();
    if (!cmd) return false;
    if (isCommandRunning()) {
      toast({
        title: "Terminal is busy",
        message: "Wait for the current command to finish, or copy this command to run it yourself.",
        variant: "info",
      });
      return false;
    }
    if (!runInActiveTerminal(cmd)) {
      toast({
        title: "No active terminal",
        message: "Open and focus a terminal before running a command from Husk.",
        variant: "error",
      });
      return false;
    }
    const cwd = getActiveTerminalCwd();
    toast({
      title: "Command sent to terminal",
      message: cwd ? `Running in ${cwd}` : "Running in the active terminal",
      variant: "info",
      duration: 2200,
    });
    return true;
  };

  const runCommand = (command: string) => {
    const cmd = command.trim();
    if (!cmd) return;
    /* Production gate: a command that mutates shared infrastructure, while a
       protected target is active, always stops for an explicit approval that
       names the target — even when the command itself looks "safe". */
    const protectedHits = protectedTargets();
    if (protectedHits.length > 0 && isEnvDestructive(cmd)) {
      setPendingRun({ command: cmd, productionTarget: protectedHits[0] });
      return;
    }
    if (isDangerousCommand(cmd)) {
      setPendingRun({ command: cmd, productionTarget: null });
      return;
    }
    sendCommandToTerminal(cmd);
  };

  const confirmRun = () => {
    if (pendingRun) {
      if (sendCommandToTerminal(pendingRun.command)) setPendingRun(null);
    }
  };

  const cancelRun = () => setPendingRun(null);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelRef.current?.clientHeight ?? 280;
  };

  const toggleExpand = () => {
    setExpanded((v) => !v);
    setHeight(null);
  };

  const handleOpenInAiTab = () => {
    setActiveSessionId(sessionId);
    onOpenInAiTab?.();
  };

  const toggleVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      const current = getSession(sessionId).input;
      setInput(current + "\n[Voice input is not supported in this environment]");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      if (event.results[event.results.length - 1]?.isFinal) {
        const current = getSession(sessionId).input;
        setInput(current ? (current + " " + transcript).trim() : transcript);
      }
    };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const attachFiles = async (paths: string[]) => {
    const newFiles: { name: string; content: string; isImage?: boolean }[] = [];
    for (const path of paths) {
      const fileName = path.split("/").pop() || path;
      const isImage = /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(fileName);
      try {
        if (isImage) {
          const b64 = await readFileBase64(path);
          newFiles.push({
            name: fileName,
            content: `![${fileName}](data:image/${fileName.split(".").pop()};base64,${b64})`,
            isImage: true,
          });
        } else {
          const text = await readFile(path);
          newFiles.push({ name: fileName, content: text });
        }
      } catch (e) {
        newFiles.push({ name: fileName, content: `[Failed to read file: ${fileName}]` });
      }
    }
    setAttachedFiles((prev) => [...prev, ...newFiles]);
  };

  const copyCode = async (code: string, idx: number) => {
    try {
      await writeText(code);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx((current) => (current === idx ? null : current)), 1500);
    } catch {
      // ignore
    }
  };

  const [msgCopiedIdx, setMsgCopiedIdx] = useState<number | null>(null);

  const copyMessage = async (content: string, idx: number) => {
    try {
      await writeText(content);
      setMsgCopiedIdx(idx);
      setTimeout(() => setMsgCopiedIdx((current) => (current === idx ? null : current)), 1500);
    } catch {
      // ignore
    }
  };

  const editMessage = (content: string) => {
    setInput(content);
    setTimeout(() => textareaRef.current?.focus(), 40);
  };

  const redoMessage = (idx: number) => {
    const msgs = getSession(sessionId).messages;
    for (let j = idx - 1; j >= 0; j--) {
      if (msgs[j].role === "user" && msgs[j].content.trim()) {
        void handleSendRef.current(msgs[j].content);
        return;
      }
    }
  };

  /* useConfig, not loadConfig: switching provider or model from the footer has to
     re-render the composer, or the model shown on each message and the
     missing-key warning would keep reporting the old choice. Safe above the early
     return below — a hook after it would change hook order between renders. */
  const cfg = useConfig();
  const provider = cfg.providerId ? getProvider(cfg.providerId) : getProvider("openai");

  const ctxTotalBytes = totalBytes(contextItems);
  const ctxOverBudget = ctxTotalBytes > budgetBytes(budgetKb);
  const capabilityLabel = provider.kind === "cli"
    ? subscriptionAutoApply && session.workspaceEditAccess && workspacePath
      ? "subscription · auto apply"
      : session.workspaceEditAccess && workspacePath
      ? "subscription · review edits"
      : "subscription · read-only"
    : prefs.aiFileToolsEnabled && !workspacePath
      ? `API · select workspace${prefs.aiMcpToolsEnabled ? " + tools" : ""}`
    : prefs.aiFileToolsEnabled || prefs.aiMcpToolsEnabled
      ? `API · ${[prefs.aiFileToolsEnabled && "files", prefs.aiMcpToolsEnabled && "tools"].filter(Boolean).join(" + ")}`
      : "API · chat only";

  if (!open || !prefs.aiEnabled) return null;

  const gap = prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined;

  const computedHeight = expanded
    ? 'min(70vh, 520px)'
    : height !== null
      ? `${height}px`
      : messages.length
        ? 'min(40vh, 280px)'
        : 'auto';
  // Manual drag resize must force real height (not just a cap) so the
  // flex-filled messages area actually grows/shrinks with the drag.
  const panelStyle =
    variant === "full"
      ? { maxHeight: '100%', height: '100%' }
      : dockSide
        /* No height here — .composer-dock-right stretches to the row instead.
           An inline `height: 100%` measured 236px inside a 216px row, because a
           percentage height needs a definite containing block and the row's
           comes from `flex: 1`. Only the width is this component's business. */
        ? { width: sideWidth, flexShrink: 0 }
        : height !== null
          ? { height: `${height}px`, maxHeight: `${height}px` }
          : { maxHeight: computedHeight };

  return (
    <div
      ref={panelRef}
      data-bg-style={prefs.aiComposerBgStyle}
      className={cn(
        "composer-panel animate-composer-in",
        expanded && "composer-expanded",
        variant === "full" && "composer-full",
        dockSide && "composer-dock-side",
        dockLeft && "composer-dock-left",
        dragOver && "composer-drag-over",
        messageAccentClass,
        className
      )}
      style={{
        ...panelStyle,
        borderRadius: dockSide ? undefined : gap && variant !== "full" ? '16px' : variant !== "full" ? '16px 16px 0 0' : '0',
        '--composer-opacity': prefs.aiMiniOpacity / 100,
        '--composer-font-size': `${prefs.aiMiniFontSize}px`,
        '--composer-bg-color': prefs.aiComposerBgColor,
        '--composer-bg-blur': `${prefs.aiMiniBgBlur}px`,
        '--composer-bg-dim': prefs.aiMiniBgDim / 100,
      } as unknown as React.CSSProperties}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const paths: string[] = [];
        if (e.dataTransfer.files) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files.item(i);
            const path = (file as unknown as { path?: string })?.path;
            if (path) paths.push(path);
          }
        }
        if (paths.length) void attachFiles(paths);
      }}
    >
      {variant !== "full" && !dockSide && (
        <div
          className="composer-resize-handle"
          onMouseDown={startResize}
          title="Drag to resize"
        />
      )}
      {dockSide && (
        <div
          className="composer-resize-handle-side"
          onMouseDown={startSideResize}
          title="Drag to resize"
        />
      )}
      <div className="composer-header">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className={cn("composer-avatar shrink-0", activeAgent?.color && `composer-avatar-accent-${activeAgent.color}`)}>
            {activeAgentIcon}
          </span>
          <div ref={agentDropdownRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setAgentDropdownOpen((v) => !v)}
              className="flex h-6 items-center gap-1 rounded border border-border/40 bg-background pl-2 pr-1 text-[11px] font-semibold text-foreground transition-colors hover:border-primary/50"
            >
              {activeAgentName}
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={11}
                strokeWidth={1.75}
                className={cn(
                  "text-muted-foreground transition-transform",
                  agentDropdownOpen && "rotate-180",
                )}
              />
            </button>
            {agentDropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-lg border border-border/60 bg-background py-1 shadow-lg">
                {agents.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setActiveAgent(a.id);
                      setAgentDropdownOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition-colors",
                      activeAgent?.id === a.id
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted/40",
                    )}
                  >
                    <span className={cn("text-[13px]", a.color && `composer-label-accent-${a.color}`)}>{a.icon}</span>
                    <div className="flex flex-col">
                      <span className="flex-1 truncate">{a.name}</span>
                    </div>
                    {activeAgent?.id === a.id && (
                      <span className="text-[10px]">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div ref={workspaceScopeRef} className="relative min-w-0 shrink">
            <button
              type="button"
              onClick={() => {
                setWorkspaceScopeOpen((value) => !value);
                setAgentDropdownOpen(false);
                setSlashOpen(false);
              }}
              className={cn("composer-workspace-scope", workspacePath && "is-scoped")}
              title={workspacePath
                ? `Workspace scope: ${workspacePath}. Change the folder this chat can use.`
                : "No workspace selected. Choose a folder to give this chat project context and API file access."}
              aria-expanded={workspaceScopeOpen}
            >
              <HugeiconsIcon icon={Folder01Icon} size={10} strokeWidth={1.75} className="shrink-0" />
              <span className="truncate">{workspaceDisplayName(workspacePath)}</span>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={10}
                strokeWidth={1.75}
                className={cn("shrink-0 transition-transform", workspaceScopeOpen && "rotate-180")}
              />
            </button>
            {workspaceScopeOpen && (
              <div className="composer-workspace-menu">
                <p className="composer-workspace-menu-label">WORKSPACE SCOPE</p>
                {workspacePath ? (
                  <div className="composer-workspace-current" title={workspacePath}>
                    <span>{workspaceDisplayName(workspacePath)}</span>
                    <small>{workspacePath}</small>
                  </div>
                ) : (
                  <p className="composer-workspace-empty">General chat. No project memory or local file tools are attached.</p>
                )}
                {provider.kind === "cli" && (
                  <div className="composer-workspace-edit-access">
                    <div>
                      <span>Reviewable workspace edits</span>
                      <small>{workspacePath ? "Proposals stay inside this folder and require your approval." : "Choose a workspace before enabling edits."}</small>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(session.workspaceEditAccess && workspacePath)}
                      disabled={!workspacePath}
                      className={cn("composer-workspace-edit-toggle", session.workspaceEditAccess && workspacePath && "is-enabled")}
                      onClick={() => setSubscriptionEditAccess(!session.workspaceEditAccess)}
                    >
                      {session.workspaceEditAccess && workspacePath ? "on" : "off"}
                    </button>
                  </div>
                )}
                {provider.kind === "cli" && session.workspaceEditAccess && workspacePath && (
                  <div className="composer-workspace-auto-access">
                    <div>
                      <span>Auto-apply safe proposals</span>
                      <small>Session only. Protected paths and larger changes still require review.</small>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={subscriptionAutoApply}
                      className={cn("composer-workspace-edit-toggle", subscriptionAutoApply && "is-enabled")}
                      onClick={() => setSubscriptionAutoApplyEnabled(!subscriptionAutoApply)}
                    >
                      {subscriptionAutoApply ? "on" : "off"}
                    </button>
                  </div>
                )}
                {variant === "docked" && isTabSessionId(sessionId) && currentWorkspacePath && currentWorkspacePath !== workspacePath && (
                  <button type="button" className="composer-workspace-menu-item" onClick={() => setChatWorkspace(currentWorkspacePath)}>
                    <HugeiconsIcon icon={Folder01Icon} size={11} strokeWidth={1.75} aria-hidden="true" /> Use current terminal workspace
                  </button>
                )}
                <button type="button" className="composer-workspace-menu-item" onClick={() => void chooseChatWorkspace()}>
                  <HugeiconsIcon icon={Folder01Icon} size={11} strokeWidth={1.75} aria-hidden="true" /> Choose folder…
                </button>
                {workspacePath && (
                  <button type="button" className="composer-workspace-menu-item is-muted" onClick={() => setChatWorkspace(null)}>
                    × Remove workspace
                  </button>
                )}
              </div>
            )}
          </div>
          <span className="composer-crumb min-w-0 truncate" title={`${activeAgentName} · ${session.name}`}>
            husk://
            <span className={cn("composer-crumb-accent", activeAgent?.color && `composer-label-accent-${activeAgent.color}`)}>
              {activeAgentName.toLowerCase().replace(/\s+/g, "-")}
            </span>
            <span className="composer-crumb-sep">/</span>
            {session.name.toLowerCase().replace(/\s+/g, "-")}
          </span>
          <button
            type="button"
            className="composer-capability shrink-0"
            onClick={() => setInspectorOpen(true)}
            title={`${provider.label} · ${cfg.model || provider.defaultModel} · ${capabilityLabel}. Inspect exact context and tool access.`}
          >
            {capabilityLabel}
          </button>
          {/* Show the open file only when it is actually attached as context —
              displaying it while excluded read as "this is being sent". */}
          {fileName && includeFile && currentFile && (
            <>
              <span className="shrink-0 text-[10px] text-muted-foreground/60">·</span>
              <span
                className="flex min-w-0 items-center gap-1 truncate text-[10px] text-primary/80"
                title={`Attached as context: ${currentFile}`}
              >
                <HugeiconsIcon icon={CommandIcon} size={10} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{fileName}</span>
              </span>
            </>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy && (
            <button
              type="button"
              onClick={stop}
              className="composer-icon-btn text-destructive"
              title="Stop generating"
            >
              <HugeiconsIcon icon={StopIcon} size={12} strokeWidth={1.75} />
            </button>
          )}
          {variant === "docked" && onOpenInAiTab && (
            <button
              type="button"
              onClick={handleOpenInAiTab}
              className="composer-icon-btn"
              title="Open in AI tab"
            >
              <HugeiconsIcon icon={MessageMultiple02Icon} size={12} strokeWidth={1.75} />
            </button>
          )}
          {variant === "docked" && !dockSide && (
            <button
              type="button"
              onClick={toggleExpand}
              className="composer-icon-btn"
              title={expanded ? "Collapse" : "Expand"}
            >
              <HugeiconsIcon icon={expanded ? ArrowDownIcon : FullScreenIcon} size={12} strokeWidth={1.75} />
            </button>
          )}
          <button
            type="button"
            onClick={newSession}
            className="composer-icon-btn"
            title="New session"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.75} />
          </button>
          {variant === "docked" && (
            <button type="button" onClick={handleClose} className="composer-icon-btn" title="Close">
              <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
            </button>
          )}
        </div>
      </div>

      {terminalWorkspaceMoved && (
        <div className="composer-workspace-moved" role="status">
          <span>
            Terminal moved to <strong>{workspaceDisplayName(currentWorkspacePath)}</strong>
          </span>
          <div>
            <button type="button" onClick={() => setChatWorkspace(currentWorkspacePath)}>use this workspace</button>
            <button type="button" onClick={() => setDismissedWorkspaceChange(workspaceChangeKey)}>keep {workspaceDisplayName(workspacePath)}</button>
            <button
              type="button"
              onClick={() => {
                newSession();
                setChatWorkspace(currentWorkspacePath);
              }}
            >
              start fresh
            </button>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="composer-messages">
        {messages.length === 0 ? (
          <div className="composer-empty">
            <div className="wb-empty-glyph">❯</div>
            <p className="wb-empty-title">what should i do?</p>
            <p className="wb-empty-sub">ask about the open file, terminal output, or generate commands</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isUser = msg.role === "user";
            const textParts = isUser ? msg.content : stripCodeBlocks(msg.content);
            const codeBlocks = isUser ? [] : parseCodeBlocks(msg.content);
            const diffBlocks = isUser ? [] : parseDiffBlocks(msg.content);
            const tree = isUser ? null : parseFileTree(msg.content);
            const timeLabel = msg.timestamp
              ? new Date(msg.timestamp).toLocaleTimeString(undefined, { hour12: false })
              : "";
            const isCompact =
              codeBlocks.length === 0 &&
              diffBlocks.length === 0 &&
              !tree &&
              !msg.trace &&
              !msg.content.includes("\n") &&
              msg.content.trim().length <= 80;
            if (isCompact) {
              return (
                <div
                  key={i}
                  className={cn("msg-block msg-block-compact", isUser ? "msg-block-user" : "msg-block-ai")}
                >
                  <span
                    className={cn(
                      "msg-role",
                      isUser ? "msg-role-user" : "msg-role-ai",
                      !isUser && activeAgent?.color && `composer-label-accent-${activeAgent.color}`
                    )}
                  >
                    {isUser ? "you" : activeAgentName.toLowerCase()}
                  </span>
                  <span className="msg-compact-text">
                    {msg.content.trim() ? msg.content : msg.streaming ? <LoadingIndicator /> : ""}
                  </span>
                  {timeLabel && <span className="msg-meta">{timeLabel}</span>}
                  <span className="msg-compact-actions">
                    <button type="button" onClick={() => copyMessage(msg.content, i)} className="msg-act msg-act-sm">
                      {msgCopiedIdx === i ? "✓" : "⧉"}
                    </button>
                    {isUser ? (
                      <button type="button" onClick={() => editMessage(msg.content)} className="msg-act msg-act-sm">
                        ✎
                      </button>
                    ) : (
                      <button type="button" onClick={() => redoMessage(i)} className="msg-act msg-act-sm">
                        ↻
                      </button>
                    )}
                  </span>
                </div>
              );
            }
            return (
              <div key={i} className={cn("msg-block", isUser ? "msg-block-user" : "msg-block-ai")}>
                <div className="msg-block-head">
                  <span
                    className={cn(
                      "msg-role",
                      isUser ? "msg-role-user" : "msg-role-ai",
                      !isUser && activeAgent?.color && `composer-label-accent-${activeAgent.color}`
                    )}
                  >
                    {isUser ? "you" : activeAgentName.toLowerCase()}
                  </span>
                  <span className="msg-meta">
                    {isUser
                      ? timeLabel
                      : `${(msg.trace?.modelLabel || cfg.model || provider.defaultModel).toLowerCase()}${timeLabel ? ` · ${timeLabel}` : ""}`}
                  </span>
                </div>
                <div className="msg-block-body">
                  {isUser ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <>
                      {textParts && <CollapsibleMarkdownText text={textParts} workspaceRoot={msg.trace?.workspacePath ?? workspacePath} />}
                      {msg.streaming && !textParts && codeBlocks.length === 0 && diffBlocks.length === 0 && !tree && <LoadingIndicator />}
                      {codeBlocks.length > 0 && (
                        <CodeBlockTabs
                          blocks={codeBlocks}
                          copiedIdx={copiedIdx}
                          onCopy={copyCode}
                          onRun={runCommand}
                          tabIndex={codeTabMap[i] ?? 0}
                          onChangeTab={(idx) => setCodeTabMap((m) => ({ ...m, [i]: idx }))}
                        />
                      )}
                      {diffBlocks.map((diff, idx) => (
                        <DiffBlock key={idx} diff={diff} />
                      ))}
                      {tree && <FileTreeBlock tree={tree} />}
                    </>
                  )}
                </div>
                {!isUser && msg.trace && <AiReplyTraceRow trace={msg.trace} />}
                <div className="msg-block-foot">
                  <button type="button" onClick={() => copyMessage(msg.content, i)} className="msg-act">
                    {msgCopiedIdx === i ? "✓ copied" : "⧉ copy"}
                  </button>
                  {isUser ? (
                    <button type="button" onClick={() => editMessage(msg.content)} className="msg-act">
                      ✎ edit
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => redoMessage(i)} className="msg-act">
                        ↻ redo
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}

        {busy && (
          <div className="msg-block msg-block-ai">
            <div className="msg-block-head">
              <span className={cn("msg-role msg-role-ai", activeAgent?.color && `composer-label-accent-${activeAgent.color}`)}>
                {activeAgentName.toLowerCase()}
              </span>
              <span className="msg-meta">streaming…</span>
            </div>
            <div className="msg-block-body">
              <div className="composer-thinking">
                <span className="composer-pulse-dot" />
                <span className="composer-thinking-text">{status || "thinking"}</span>
                <span className="composer-blob composer-blob-1" />
                <span className="composer-blob composer-blob-2" />
                <span className="composer-blob composer-blob-3" />
              </div>
            </div>
          </div>
        )}
        {/* Inside the scroll area rather than pinned beside it. These render
            only on an empty thread, so they are part of the empty state — but
            as a sibling of .composer-messages they reserved ~60px of panel
            height permanently. That is most of why the dock's non-scrolling
            chrome (236px) could not fit the row it lives in (216px) and spilled
            over the command bar. */}
        {messages.length === 0 && (
          <div className="composer-prompt-templates">
            {prefs.aiPromptTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setInput(t.prompt);
                  textareaRef.current?.focus();
                }}
                className="composer-prompt-template-btn"
                title={t.prompt}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {pendingRun && (
        <div className="composer-pending-run">
          <div className="flex flex-col gap-0.5">
            {pendingRun.productionTarget ? (
              <>
                <span className="text-[10px] font-medium text-amber-400">
                  ⚠️ You are targeting {pendingRun.productionTarget} — approve to run
                </span>
                <code className="text-[10px] text-foreground/80">{pendingRun.command}</code>
              </>
            ) : (
              <>
                <span className="text-[10px] font-medium text-amber-400">⚠️ Dangerous command — approve to run</span>
                <code className="text-[10px] text-foreground/80">{pendingRun.command}</code>
              </>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={confirmRun} className="composer-approve-btn">
              {pendingRun.productionTarget ? "Run anyway" : "Run"}
            </button>
            <button type="button" onClick={cancelRun} className="composer-cancel-btn">
              Cancel
            </button>
          </div>
        </div>
      )}

      {budgetPrompt && (
        <div className="composer-pending-run">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-amber-400">
              ⚠️ Context exceeds your {budgetKb} KB limit ({formatKb(budgetPrompt.total)} attached)
            </span>
            <span className="text-[9.5px] text-muted-foreground">
              Nothing is cut silently — choose how to proceed.
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="composer-cancel-btn"
              onClick={() => {
                setBudgetPrompt(null);
                setInspectorOpen(true);
              }}
            >
              Remove items
            </button>
            <button
              type="button"
              className="composer-cancel-btn"
              onClick={() => {
                setPrefs({ aiContextBudgetKb: 64 });
                setBudgetPrompt(null);
              }}
            >
              Raise to 64 KB
            </button>
            <button
              type="button"
              className="composer-approve-btn"
              title={(() => {
                const { dropped } = fitWithinBudget(contextItems, budgetKb);
                return dropped.length > 0 ? `Not sent: ${dropped.map((d) => d.label).join(", ")}` : "Everything fits";
              })()}
              onClick={() => {
                setBudgetPrompt(null);
                void handleSendRef.current(undefined, { fitToBudget: true });
              }}
            >
              Send what fits
            </button>
            <button type="button" className="composer-cancel-btn" onClick={() => setBudgetPrompt(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {sensitivePrompt && (
        <div className="composer-pending-run">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-amber-400">
              ⚠️ {sensitivePrompt.length} item{sensitivePrompt.length === 1 ? "" : "s"} may contain secrets:{" "}
              {sensitivePrompt.map((i) => i.label).join(", ")}
            </span>
            <span className="text-[9.5px] text-muted-foreground">
              Possible {sensitivePrompt[0]?.sensitiveReasons.join(", ") ?? "secret"} — review before this leaves the machine.
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="composer-cancel-btn"
              onClick={() => {
                setSensitivePrompt(null);
                setInspectorOpen(true);
              }}
            >
              Review
            </button>
            <button
              type="button"
              className="composer-approve-btn"
              onClick={() => {
                setSensitivePrompt(null);
                void handleSendRef.current(undefined, { allowSensitive: true });
              }}
            >
              Send anyway
            </button>
            <button type="button" className="composer-cancel-btn" onClick={() => setSensitivePrompt(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div ref={slashPaletteRef} className="composer-input-wrapper">
        {slashOpen && (
          <div className="composer-slash-palette">
            {filteredSlash.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-muted-foreground">No commands</div>
            ) : (
              filteredSlash.map((cmd, idx) => (
                <button
                  key={cmd.id}
                  type="button"
                  onClick={() => {
                    cmd.run();
                    setSlashOpen(false);
                    if (cmd.id !== "/attach" && cmd.id !== "/agent") {
                      setTimeout(() => textareaRef.current?.focus(), 50);
                    }
                  }}
                  className={cn(
                    "composer-slash-palette-item",
                    idx === slashIndex && "composer-slash-palette-item-active",
                  )}
                  onMouseEnter={() => setSlashIndex(idx)}
                >
                  <span className="text-[13px]">{cmd.icon}</span>
                  <div className="flex flex-col">
                    <span className="font-medium">{cmd.label}</span>
                    <span className="composer-slash-palette-item-desc">{cmd.desc}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
        <AppliedEditsActivity sessionId={sessionId} />
        <PendingEditsReview sessionId={sessionId} />
        <div className="wb-composer">
          {chipItems.length > 0 && (
            <div className="wb-composer-head">
              {chipItems.map((item) => (
                <span
                  key={item.id}
                  className={cn(
                    "wb-chip",
                    item.kind === "command-run" && "wb-chip-evidence",
                    item.sensitive && "wb-chip-sensitive",
                  )}
                >
                  <span>{item.icon}</span>
                  {item.preview ? (
                    <button
                      type="button"
                      onClick={() => setPreviewChipId((id) => (id === item.id ? null : item.id))}
                      className="truncate max-w-[220px] underline decoration-dotted underline-offset-2"
                      title={`${item.label} · ${formatKb(item.bytes)} — show exactly what will be sent`}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span className="truncate max-w-[140px]" title={`${item.label} · ${formatKb(item.bytes)}`}>{item.label}</span>
                  )}
                  {item.sensitive && (
                    <span
                      className="wb-chip-warn"
                      title={`May contain ${item.sensitiveReasons.join(", ")} — review before sending`}
                    >
                      ⚠
                    </span>
                  )}
                  <button type="button" onClick={() => removeContextItem(item.id)} className="wb-chip-x">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {runPickerOpen && (
            <div className="wb-ctx-preview">
              <div className="wb-ctx-preview-head">
                <span>Attach a command's output</span>
                <button type="button" onClick={() => setRunPickerOpen(false)}>close</button>
              </div>
              {getRecentCommandRuns().length === 0 ? (
                <div className="wb-run-empty">
                  Nothing recorded yet — run a command in the terminal first.
                </div>
              ) : (
                getRecentCommandRuns().map((run) => (
                  <button
                    key={run.at}
                    type="button"
                    className="wb-run-item"
                    onClick={() => {
                      setAttachedRuns((rs) => (rs.some((r) => r.at === run.at) ? rs : [...rs, run]));
                      setRunPickerOpen(false);
                    }}
                  >
                    <span className="wb-run-cmd">{run.command || "(command)"}</span>
                    <span className={run.exitCode === 0 ? "wb-run-ok" : "wb-run-bad"}>
                      exit {run.exitCode ?? "?"}
                    </span>
                    <span className="wb-run-size">
                      {Math.round(run.output.length / 102.4) / 10} KB
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
          {previewChip && (
            <div className="wb-ctx-preview">
              <div className="wb-ctx-preview-head">
                <span>{previewChip.label}</span>
                <button type="button" onClick={() => setPreviewChipId(null)}>close</button>
              </div>
              <pre>{previewChip.preview}</pre>
            </div>
          )}
          <div className="wb-composer-body">
            <span className="wb-prompt">❯</span>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (slashOpen) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % filteredSlash.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((i) => (i - 1 + filteredSlash.length) % filteredSlash.length);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const cmd = filteredSlash[slashIndex];
                    if (cmd) {
                      cmd.run();
                      setSlashOpen(false);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    setSlashOpen(false);
                    return;
                  }
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
                if (e.key === "Escape" && variant === "docked") {
                  handleClose();
                }
              }}
              placeholder="ask husk…"
              rows={1}
              className="composer-textarea"
            />
            <button
              type="button"
              onClick={toggleVoice}
              className={cn("wb-icon-btn", listening && "recording")}
              title={listening ? "Stop listening" : "Voice input"}
            >
              <HugeiconsIcon icon={VoiceIcon} size={12} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={handleFileUpload}
              className="wb-icon-btn"
              title="Attach file"
            >
              <HugeiconsIcon icon={AttachmentSquareIcon} size={12} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => handleSend()}
              disabled={busy || !input.trim()}
              className="composer-send-btn"
              title="Send"
            >
              {busy ? "…" : "⏎"}
            </button>
          </div>
        </div>
      </div>

      <div className="composer-footer">
        <span className="wb-status-left">
          {/* The status line is the switcher — see ai/ModelSwitcher. */}
          <ModelSwitcher busy={busy} />
          <button
            type="button"
            onClick={() => setInspectorOpen(true)}
            className={cn("wb-ctx-inspect", ctxOverBudget && "wb-ctx-inspect-over")}
            title={`${formatKb(ctxTotalBytes)} of ${budgetKb} KB context budget used · ${contextItems.length} item${contextItems.length === 1 ? "" : "s"} attached — review exactly what the AI can see`}
          >
            Context: {formatKb(ctxTotalBytes)} / {budgetKb} KB · {contextItems.length} item{contextItems.length === 1 ? "" : "s"} · Inspect ›
          </button>
        </span>
        <span className="wb-status-right">
          ⌘⏎ send{variant === "docked" ? " · esc close · ctrl+shift+L toggle" : ""}
        </span>
      </div>

      {inspectorOpen && (
        <ContextInspector
          items={contextItems}
          budgetKb={budgetKb}
          tools={{
            modelLabel: activeAgent?.model || cfg.model || provider.defaultModel,
            providerLabel: provider.label,
            providerKind: provider.kind,
            fileToolsEnabled: prefs.aiFileToolsEnabled,
            mcpToolsEnabled: prefs.aiMcpToolsEnabled,
            workspacePath: workspacePath || undefined,
          }}
          onRemove={removeContextItem}
          onClearAll={clearAllContext}
          onClose={() => {
            setInspectorOpen(false);
            setTimeout(() => textareaRef.current?.focus(), 40);
          }}
        />
      )}
    </div>
  );
}

function CodeBlockTabs({
  blocks,
  copiedIdx,
  onCopy,
  onRun,
  tabIndex,
  onChangeTab,
}: {
  blocks: CodeBlock[];
  copiedIdx: number | null;
  onCopy: (code: string, idx: number) => void;
  onRun: (code: string) => void;
  tabIndex: number;
  onChangeTab: (idx: number) => void;
}) {
  if (blocks.length === 1) {
    return <CodeBlockCard block={blocks[0]} idx={0} copiedIdx={copiedIdx} onCopy={onCopy} onRun={onRun} />;
  }
  const active = blocks[tabIndex] || blocks[0];
  return (
    <div className="composer-code-block">
      <div className="composer-code-tabs">
        <div className="composer-code-tab-list">
          {blocks.map((b, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChangeTab(i)}
              className={cn("composer-code-tab", i === tabIndex && "composer-code-tab-active")}
            >
              {b.lang || "code"}
            </button>
          ))}
        </div>
        <CodeActions block={active} idx={tabIndex} copiedIdx={copiedIdx} onCopy={onCopy} onRun={onRun} />
      </div>
      <CodeBlockPre block={active} />
    </div>
  );
}

function CodeBlockCard({
  block,
  idx,
  copiedIdx,
  onCopy,
  onRun,
}: {
  block: CodeBlock;
  idx: number;
  copiedIdx: number | null;
  onCopy: (code: string, idx: number) => void;
  onRun: (code: string) => void;
}) {
  return (
    <div className="composer-code-block">
      <div className="composer-code-header">
        <span className="lang">{block.lang || "code"}</span>
        <CodeActions block={block} idx={idx} copiedIdx={copiedIdx} onCopy={onCopy} onRun={onRun} />
      </div>
      <CodeBlockPre block={block} />
    </div>
  );
}

function CodeActions({
  block,
  idx,
  copiedIdx,
  onCopy,
  onRun,
}: {
  block: CodeBlock;
  idx: number;
  copiedIdx: number | null;
  onCopy: (code: string, idx: number) => void;
  onRun: (command: string) => void;
}) {
  const run = getTerminalRunDecision(block.lang, block.code);
  return (
    <div className="composer-code-actions">
      <button
        type="button"
        onClick={() => onCopy(block.code, idx)}
        className="composer-code-header-btn"
        title="Copy"
      >
        <HugeiconsIcon icon={copiedIdx === idx ? TickDouble01Icon : Copy01Icon} size={10} strokeWidth={1.75} />
        {copiedIdx === idx ? "Copied" : "Copy"}
      </button>
      {run.runnable ? (
        <button
          type="button"
          onClick={() => onRun(run.command)}
          className="composer-run-btn"
          title="Run this one command in the active terminal"
        >
          <HugeiconsIcon icon={ComputerTerminal02Icon} size={10} strokeWidth={1.75} />
          Run command
        </button>
      ) : (
        <span className="composer-code-manual" title={run.reason}>review before running</span>
      )}
    </div>
  );
}

function CodeBlockPre({ block }: { block: CodeBlock }) {
  return (
    <pre className="composer-code-pre">
      <code>{block.code}</code>
    </pre>
  );
}

function DiffBlock({ diff }: { diff: DiffBlockType }) {
  return (
    <div className="composer-diff-block">
      <div className="composer-diff-header">
        <span>Diff</span>
        <span className="text-[9px] text-muted-foreground/60">{diff.lines.length} lines</span>
      </div>
      <div className="max-h-60 overflow-y-auto">
        {diff.lines.map((line: { kind: "add" | "del" | "ctx"; text: string }, i: number) => (
          <div
            key={i}
            className={cn(
              "composer-diff-line",
              line.kind === "add" && "composer-diff-line-add",
              line.kind === "del" && "composer-diff-line-del",
              line.kind === "ctx" && "composer-diff-line-ctx",
            )}
          >
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function FileTreeBlock({ tree }: { tree: FileTreeNode[] }) {
  return (
    <div className="composer-filetree">
      <div className="text-[10px] font-semibold text-muted-foreground mb-1">Files</div>
      {tree.map((node, i) => (
        <div key={i} className="composer-filetree-row">
          <span className="composer-filetree-row-indent" />
          <span>📄</span>
          <span>{node.name}</span>
        </div>
      ))}
    </div>
  );
}
