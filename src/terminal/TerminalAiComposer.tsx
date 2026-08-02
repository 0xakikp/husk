import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  VolumeHighIcon,
  VolumeOffIcon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { usePrefs, setPrefs } from "../settings/preferences";
import { loadConfig, getKey } from "../ai/store";
import { getProvider } from "../ai/providers";
import { streamChat } from "../ai/client";
import type { Tool } from "ai";
import { getActiveAgent, useAgents, setActiveAgent } from "../ai/agents";
import { readActiveTerminal, runInActiveTerminal, getRecentCommandRuns, type CommandRun } from "../ai/terminalContext";
import { PendingEditsReview } from "../ai/PendingEditsReview";
import { getTerminalContextSize } from "../ai/useTerminalContextSize";
import { projectMemoryBlock } from "../ai/projectMemory";
import { registerComposerToggle, registerComposerOpen, registerComposerSend } from "../ai/bubbleStore";
import { getEditorFile, getEditorSelection } from "../ai/editorStore";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile, readFileBase64 } from "../fs";
import { buildMcpTools } from "../mcp/tools";
import { buildBuiltinTools, mergeTools } from "../ai/builtinTools";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  AiMessage,
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
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    blocks.push({ lang: match[1] || "sh", code: match[2].trim() });
  }
  return blocks;
}

function stripCodeBlocks(text: string): string {
  return text.replace(/```(\w*)\n?([\s\S]*?)```/g, "").trim();
}

function renderInline(text: string): ReactNode[] {
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
      nodes.push(<code key={key++} className="wb-inline-code">{tok.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    }
    last = idx + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function MarkdownText({ text }: { text: string }) {
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
              <span className="wb-md-li-text">{renderInline(bullet[1])}</span>
            </div>
          );
        }
        if (numbered) {
          return (
            <div key={i} className="wb-md-li">
              <span className="wb-md-marker">{numbered[1]}.</span>
              <span className="wb-md-li-text">{renderInline(numbered[2])}</span>
            </div>
          );
        }
        if (!trimmed) return <div key={i} className="wb-md-gap" />;
        return (
          <div key={i} className="wb-md-p">
            {renderInline(line)}
          </div>
        );
      })}
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

function extractCommandFromCode(code: string): string {
  const lines = code.split("\n").filter(Boolean);
  return lines[0] || code;
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
  dock?: "bottom" | "right";
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
  const [runPickerOpen, setRunPickerOpen] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const speakUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

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
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<(textOverride?: string) => Promise<void>>(async () => {});
  const agentDropdownRef = useRef<HTMLDivElement>(null);
  const slashPaletteRef = useRef<HTMLDivElement>(null);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [codeTabMap, setCodeTabMap] = useState<Record<number, number>>({});

  // Right-dock (side panel) state
  const dockRight = dock === "right" && variant === "docked";
  const sideDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const [sideWidth, setSideWidth] = useState(prefs.aiComposerSideWidth ?? 380);
  const sideWidthRef = useRef(sideWidth);

  const session = getSession(sessionId);
  const messages = session.messages;
  const input = session.input;

  const setInput = (value: string) => {
    updateSession(sessionId, (s) => ({ ...s, input: value }));
  };

  const setMessages = (updater: (prev: AiMessage[]) => AiMessage[]) => {
    updateSession(sessionId, (s) => ({ ...s, messages: updater(s.messages) }));
  };

  const newSession = useCallback(() => {
    updateSession(sessionId, () => ({ ...getSession(sessionId), messages: [], input: "" }));
    setIncludeFile(true);
    setIncludeSelection(true);
    setIncludeTerminal(true);
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

  // Context chips
  const currentFile = useMemo(() => getEditorFile(), [tick]);
  const selection = useMemo(() => getEditorSelection(), [tick]);
  const fileName = currentFile ? currentFile.split("/").pop() : null;
  const [includeFile, setIncludeFile] = useState(true);
  const [includeSelection, setIncludeSelection] = useState(true);
  const [includeTerminal, setIncludeTerminal] = useState(true);

  const contextChips = useMemo(() => {
    const chips: {
      id: string;
      icon: string;
      label: string;
      onRemove: () => void;
      /** Exactly what this chip contributes to the request, for the preview. */
      preview?: string;
    }[] = [];
    if (currentFile && includeFile) {
      chips.push({
        id: "file",
        icon: "📄",
        label: fileName || currentFile,
        onRemove: () => setIncludeFile(false),
      });
    }
    if (selection && includeSelection) {
      chips.push({
        id: "selection",
        icon: "📋",
        label: `selection:${selection.startLine}-${selection.endLine}`,
        onRemove: () => setIncludeSelection(false),
      });
    }
    for (const run of attachedRuns) {
      const label = run.command.trim() || "(command)";
      chips.push({
        id: `run:${run.at}`,
        icon: "▶",
        label: `${label.length > 26 ? `${label.slice(0, 25)}…` : label} · ${Math.round(run.output.length / 102.4) / 10} KB`,
        onRemove: () => setAttachedRuns((rs) => rs.filter((r) => r.at !== run.at)),
        preview: `$ ${run.command}\n${run.output}`,
      });
    }
    if (includeTerminal) {
      /* Show the size. Terminal scrollback routinely contains echoed API keys,
         kubectl output, connection strings and internal hostnames, and all of it
         leaves the machine on send — so how much is going is worth stating, and
         the chip is clickable to see exactly what. */
      const term = readActiveTerminal();
      const { kb, capped } = getTerminalContextSize();
      chips.push({
        id: "terminal",
        icon: "🖥️",
        label: `terminal output · ${kb} KB${capped ? " (tail)" : ""}`,
        onRemove: () => setIncludeTerminal(false),
        preview: term,
      });
    }
    return chips;
  }, [currentFile, fileName, selection, includeFile, includeSelection, includeTerminal, attachedRuns]);

  const previewChip = contextChips.find((c) => c.id === previewChipId && c.preview);

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

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!agentDropdownOpen && !slashOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!agentDropdownRef.current?.contains(e.target as Node)) {
        setAgentDropdownOpen(false);
      }
      if (!slashPaletteRef.current?.contains(e.target as Node)) {
        setSlashOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [agentDropdownOpen, slashOpen]);

  // Ensure the session exists (terminal tabs get created on first composer mount)
  useEffect(() => {
    if (isTabSessionId(sessionId)) {
      const tabId = parseInt(sessionId.slice(4), 10);
      ensureSession(sessionId, { name: tabSessionName(sessionId), source: "terminal", tabId });
    }
  }, [sessionId]);

  useEffect(() => {
    if (!registerToggle) return;
    return registerComposerToggle(() => setOpen((v) => !v));
  }, []);

  useEffect(() => {
    if (!registerOpen) return;
    return registerComposerOpen((text) => {
      setOpen(true);
      if (text) {
        setInput(text);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    });
  }, []);

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
  }, []);

  useEffect(() => {
    return subscribeSessions(() => setTick((v) => v + 1));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, tick, busy, status]);

  const handleSend = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
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
    try {
      const mcpTools = await buildMcpTools().catch(() => ({}));
      const builtinTools = buildBuiltinTools();
      tools = mergeTools(builtinTools, mcpTools);
    } catch (e) {
      if (import.meta.env.DEV) {
        console.warn("[AI] tool build failed", e);
      }
    }

    const agent = getActiveAgent();
    let system =
      agent.systemPrompt +
      "\n\nYou are a helpful coding/terminal assistant inside Husk. Respond concisely. If you suggest a shell command, wrap it in a code block." +
      // Per-workspace background, so the stack does not need re-explaining each session.
      projectMemoryBlock();

    if (currentFile && includeFile) {
      try {
        const content = await readFile(currentFile);
        system += `\n\nCurrent open file: ${currentFile}`;
        if (selection && includeSelection) {
          system += `\nSelected lines ${selection.startLine}-${selection.endLine}:\n\`\`\`\n${selection.text}\n\`\`\``;
        }
        system += `\n\nFull file content:\n\`\`\`\n${content}\n\`\`\``;
      } catch {
        system += `\n\nCurrent open file: ${currentFile} (could not read content)`;
      }
    }

    if (attachedFiles.length > 0) {
      const fileBlock = attachedFiles
        .map((f) => (f.isImage ? `--- attached image: ${f.name} ---\n${f.content}` : `--- attached file: ${f.name} ---\n\`\`\`\n${f.content}\n\`\`\``))
        .join("\n\n");
      system += `\n\nAttached files:\n${fileBlock}`;
    }

    if (includeTerminal) {
      const ctx = readActiveTerminal();
      if (ctx) {
        system += `\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\``;
      }
    }

    try {
      await streamChat(
        {
          provider,
          model: cfg.model || agent.model || provider.defaultModel,
          apiKey,
          baseURL: cfg.baseURL,
        },
        system,
        [...messages, { role: "user", content: text }],
        (delta) => {
          if (abortRef.current) return;
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
      );
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
      const finalMessages = getSession(sessionId).messages;
      const assistantMsg = [...finalMessages].reverse().find((m: AiMessage) => m.role === "assistant" && !m.streaming);
      if (assistantMsg?.content) {
        speakText(assistantMsg.content);
      }
    }
  }, [input, busy, messages, sessionId, attachedFiles, currentFile, selection, includeFile, includeSelection, includeTerminal]);

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
      const delta = startXRef.current - e.clientX;
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

  const runCommand = (cmd: string) => {
    const first = extractCommandFromCode(cmd);
    if (isDangerousCommand(first)) {
      setPendingRun(first);
    } else {
      runInActiveTerminal(first);
    }
  };

  const confirmRun = () => {
    if (pendingRun) {
      runInActiveTerminal(pendingRun);
      setPendingRun(null);
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

  const removeAttachedFile = (idx: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== idx));
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

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  };

  const speakText = (text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    stopSpeaking();
    const clean = stripCodeBlocks(text).replace(/!\[.*?\]\(.*?\)/g, "[image]").slice(0, 4000);
    const FEMALE_VOICE_RE =
      /samantha|victoria|karen|joanna|kimberly|salli|emma|amy|catherine|moira|zira|zhiyu|laila|meijia|serena|allison|ava(?!lanche)|susan|kate|stephanie|melissa|nicky|joelle|fiona|tessa/i;
    const speak = (voices: SpeechSynthesisVoice[]) => {
      const utterance = new SpeechSynthesisUtterance(clean);
      const prefName = prefs.aiTtsVoice;
      let voice = prefName ? voices.find((v) => v.name === prefName) : undefined;
      if (!voice) voice = voices.find((v) => FEMALE_VOICE_RE.test(v.name));
      if (!voice) voice = voices.find((v) => /female/i.test(v.name));
      if (voice) utterance.voice = voice;
      utterance.rate = 1.05;
      utterance.pitch = 1.1;
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      speakUtteranceRef.current = utterance;
      setSpeaking(true);
      window.speechSynthesis.speak(utterance);
    };
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      speak(voices);
    } else {
      // Voices load asynchronously in some environments — wait once.
      const onChanged = () => {
        window.speechSynthesis.removeEventListener("voiceschanged", onChanged);
        speak(window.speechSynthesis.getVoices());
      };
      window.speechSynthesis.addEventListener("voiceschanged", onChanged);
      setTimeout(() => window.speechSynthesis.removeEventListener("voiceschanged", onChanged), 1500);
    }
  };

  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  const cfg = loadConfig();
  const provider = cfg.providerId ? getProvider(cfg.providerId) : getProvider("openai");

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
      : dockRight
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
        dockRight && "composer-dock-right",
        dragOver && "composer-drag-over",
        messageAccentClass,
        className
      )}
      style={{
        ...panelStyle,
        borderRadius: dockRight ? undefined : gap && variant !== "full" ? '16px' : variant !== "full" ? '16px 16px 0 0' : '0',
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
      {variant !== "full" && !dockRight && (
        <div
          className="composer-resize-handle"
          onMouseDown={startResize}
          title="Drag to resize"
        />
      )}
      {dockRight && (
        <div
          className="composer-resize-handle-side"
          onMouseDown={startSideResize}
          title="Drag to resize"
        />
      )}
      <div className="composer-header">
        <div className="flex items-center gap-2">
          <span className={cn("composer-avatar", activeAgent?.color && `composer-avatar-accent-${activeAgent.color}`)}>
            {activeAgentIcon}
          </span>
          <div ref={agentDropdownRef} className="relative">
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
          <span className="composer-crumb">
            husk://
            <span className={cn("composer-crumb-accent", activeAgent?.color && `composer-label-accent-${activeAgent.color}`)}>
              {activeAgentName.toLowerCase().replace(/\s+/g, "-")}
            </span>
            <span className="composer-crumb-sep">/</span>
            {session.name.toLowerCase().replace(/\s+/g, "-")}
          </span>
          {fileName && (
            <>
              <span className="text-[10px] text-muted-foreground/60">·</span>
              <span className="flex items-center gap-1 text-[10px] text-primary/80">
                <HugeiconsIcon icon={CommandIcon} size={10} strokeWidth={1.5} />
                {fileName}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
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
          <button
            type="button"
            onClick={speaking ? stopSpeaking : () => {
              const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && !m.streaming);
              if (lastAssistant?.content) speakText(lastAssistant.content);
            }}
            className={cn("composer-icon-btn", speaking && "composer-icon-btn-speaking")}
            title={speaking ? "Stop speaking" : "Read last response"}
          >
            <HugeiconsIcon icon={speaking ? VolumeOffIcon : VolumeHighIcon} size={12} strokeWidth={1.75} />
          </button>
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
          {variant === "docked" && !dockRight && (
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
                      : `${(cfg.model || provider.defaultModel).toLowerCase()}${timeLabel ? ` · ${timeLabel}` : ""}`}
                  </span>
                </div>
                <div className="msg-block-body">
                  {isUser ? (
                    <div className="whitespace-pre-wrap">{msg.content}</div>
                  ) : (
                    <>
                      {textParts && <MarkdownText text={textParts} />}
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
                      {codeBlocks.length > 0 && (
                        <button type="button" onClick={() => runCommand(codeBlocks[0].code)} className="msg-act msg-act-hot">
                          ▸ run in terminal
                        </button>
                      )}
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
            <span className="text-[10px] font-medium text-amber-400">⚠️ Dangerous command — approve to run</span>
            <code className="text-[10px] text-foreground/80">{pendingRun}</code>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={confirmRun} className="composer-approve-btn">
              Run
            </button>
            <button type="button" onClick={cancelRun} className="composer-cancel-btn">
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
        <PendingEditsReview />
        <div className="wb-composer">
          {(contextChips.length > 0 || attachedFiles.length > 0) && (
            <div className="wb-composer-head">
              {contextChips.map((chip) => (
                <span key={chip.id} className="wb-chip">
                  <span>{chip.icon}</span>
                  {chip.preview ? (
                    <button
                      type="button"
                      onClick={() => setPreviewChipId((id) => (id === chip.id ? null : chip.id))}
                      className="truncate max-w-[220px] underline decoration-dotted underline-offset-2"
                      title="Show exactly what will be sent"
                    >
                      {chip.label}
                    </button>
                  ) : (
                    <span className="truncate max-w-[140px]">{chip.label}</span>
                  )}
                  <button type="button" onClick={chip.onRemove} className="wb-chip-x">
                    ×
                  </button>
                </span>
              ))}
              {attachedFiles.map((f, idx) => (
                <span key={`${f.name}-${idx}`} className="wb-chip">
                  <span>📎</span>
                  <span className="truncate max-w-[140px]">{f.name}</span>
                  <button type="button" onClick={() => removeAttachedFile(idx)} className="wb-chip-x">
                    ×
                  </button>
                </span>
              ))}
              <span className="wb-ctx-count">ctx: {contextChips.length + attachedFiles.length} attached</span>
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
          <span className="wb-status-dot">●</span>
          {provider.label.toLowerCase()} · {(cfg.model || provider.defaultModel).toLowerCase()} · {busy ? "streaming" : "connected"}
          {currentFile && includeFile ? " · file ctx" : ""}
        </span>
        <span className="wb-status-right">
          ⌘⏎ send{variant === "docked" ? " · esc close · ctrl+shift+L toggle" : ""}
        </span>
      </div>
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
      <CodeBlockCard block={active} idx={tabIndex} copiedIdx={copiedIdx} onCopy={onCopy} onRun={onRun} hideHeader />
    </div>
  );
}

function CodeBlockCard({
  block,
  idx,
  copiedIdx,
  onCopy,
  onRun,
  hideHeader,
}: {
  block: CodeBlock;
  idx: number;
  copiedIdx: number | null;
  onCopy: (code: string, idx: number) => void;
  onRun: (code: string) => void;
  hideHeader?: boolean;
}) {
  return (
    <div className="composer-code-block">
      {!hideHeader && (
        <div className="composer-code-header">
          <span className="lang">{block.lang}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onCopy(block.code, idx)}
              className="composer-code-header-btn"
              title="Copy"
            >
              <HugeiconsIcon icon={copiedIdx === idx ? TickDouble01Icon : Copy01Icon} size={10} strokeWidth={1.75} />
              {copiedIdx === idx ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={() => onRun(block.code)}
              className="composer-run-btn"
            >
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={10} strokeWidth={1.75} />
              Run
            </button>
          </div>
        </div>
      )}
      <pre className="composer-code-pre">
        <code>{block.code}</code>
      </pre>
    </div>
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
