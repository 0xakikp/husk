import { useCallback, useEffect, useRef, useState } from "react";
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
} from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { usePrefs } from "../settings/preferences";
import { loadConfig, getKey } from "../ai/store";
import { getProvider } from "../ai/providers";
import { streamChat } from "../ai/client";
import { getActiveAgent } from "../ai/agents";
import { readActiveTerminal, runInActiveTerminal } from "../ai/terminalContext";
import { registerComposerToggle, registerComposerOpen, registerComposerSend } from "../ai/bubbleStore";
import { getEditorFile, getEditorSelection } from "../ai/editorStore";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile, readFileBase64 } from "../fs";
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

export function tabSessionId(tabId: number): string {
  return `tab-${tabId}`;
}

export function tabSessionName(sessionId: string): string {
  if (!isTabSessionId(sessionId)) return sessionId;
  const tabId = parseInt(sessionId.slice(4), 10);
  return isNaN(tabId) ? sessionId : `Terminal ${tabId}`;
}

export function TerminalAiComposer({
  sessionId,
  onOpenInAiTab,
  variant = "docked",
  registerToggle = true,
  registerOpen = true,
  registerSend = false,
}: {
  sessionId: string;
  onOpenInAiTab?: () => void;
  variant?: "docked" | "full";
  registerToggle?: boolean;
  registerOpen?: boolean;
  registerSend?: boolean;
}) {
  const prefs = usePrefs();
  const [open, setOpen] = useState(variant === "full");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  const abortRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<(textOverride?: string) => Promise<void>>(async () => {});
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Ensure the session exists (terminal tabs get created on first composer mount)
  useEffect(() => {
    if (isTabSessionId(sessionId)) {
      const tabId = parseInt(sessionId.slice(4), 10);
      ensureSession(sessionId, { name: tabSessionName(sessionId), source: "terminal", tabId });
    }
  }, [sessionId]);

  // Auto-focus textarea when composer opens
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => textareaRef.current?.focus(), 80);
      return () => clearTimeout(id);
    }
  }, [open]);

  const session = getSession(sessionId);
  const messages = session.messages;
  const input = session.input;

  const setInput = (value: string) => {
    updateSession(sessionId, (s) => ({ ...s, input: value }));
  };

  const setMessages = (updater: (prev: AiMessage[]) => AiMessage[]) => {
    updateSession(sessionId, (s) => ({ ...s, messages: updater(s.messages) }));
  };

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
  }, [messages, tick, busy]);

  const handleSend = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    abortRef.current = false;
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = new AbortController();

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setMessages((prev) => [...prev, { role: "assistant", content: "", streaming: true }]);

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
      return;
    }

    const agent = getActiveAgent();
    let system =
      agent.systemPrompt +
      "\n\nYou are a helpful coding/terminal assistant inside Husk. Respond concisely. If you suggest a shell command, wrap it in a code block.";

    const currentFile = getEditorFile();
    const selection = getEditorSelection();
    if (currentFile) {
      try {
        const content = await readFile(currentFile);
        system += `\n\nCurrent open file: ${currentFile}`;
        if (selection) {
          system += `\nSelected lines ${selection.startLine}-${selection.endLine}:\n\`\`\`\n${selection.text}\n\`\`\``;
        }
        system += `\n\nFull file content:\n\`\`\`\n${content}\n\`\`\``;
      } catch {
        system += `\n\nCurrent open file: ${currentFile} (could not read content)`;
      }
    }

    const ctx = readActiveTerminal();
    if (ctx) {
      system += `\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\``;
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
        {},
        abortCtrlRef.current.signal,
      );
    } catch (e) {
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
    }
  }, [input, busy, messages, sessionId]);

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

  const handleClose = () => {
    abortRef.current = true;
    abortCtrlRef.current?.abort();
    setOpen(false);
    setBusy(false);
  };

  const newSession = () => {
    updateSession(sessionId, () => ({ ...session, messages: [], input: "" }));
  };

  const runCommand = (cmd: string) => {
    setPendingRun(cmd);
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

  // Voice input using Web Speech API
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

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

  const handleFileUpload = async () => {
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
  };

  const cfg = loadConfig();
  const provider = cfg.providerId ? getProvider(cfg.providerId) : getProvider("openai");

  if (!open || !prefs.aiEnabled) return null;

  const currentFile = getEditorFile();
  const fileName = currentFile ? currentFile.split("/").pop() : null;

  const gap = prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined;

  const computedHeight = expanded
    ? 'min(70vh, 520px)'
    : height !== null
      ? `${height}px`
      : messages.length
        ? 'min(40vh, 280px)'
        : 'auto';
  const panelStyle = variant === "full" ? { maxHeight: '100%', height: '100%' } : { maxHeight: computedHeight };

  return (
  <div
    ref={panelRef}
    data-bg-style={prefs.aiComposerBgStyle}
    className={cn(
      "composer-panel animate-composer-in",
      expanded && "composer-expanded",
      variant === "full" && "composer-full"
    )}
    style={{
      ...panelStyle,
      borderRadius: gap && variant !== "full" ? '16px' : variant !== "full" ? '16px 16px 0 0' : '0',
      '--composer-opacity': prefs.aiMiniOpacity / 100,
      '--composer-font-size': `${prefs.aiMiniFontSize}px`,
      '--composer-bg-color': prefs.aiComposerBgColor,
      '--composer-bg-blur': `${prefs.aiMiniBgBlur}px`,
      '--composer-bg-dim': prefs.aiMiniBgDim / 100,
    } as unknown as React.CSSProperties}
  >
      {variant !== "full" && (
        <div
          className="composer-resize-handle"
          onMouseDown={startResize}
          title="Drag to resize"
        />
      )}
      <div className="composer-glow" />

      <div className="composer-header">
        <div className="flex items-center gap-2">
          <span className="composer-avatar">✦</span>
          <span className="text-[11px] font-semibold text-foreground">Husk AI</span>
          <span className="text-[10px] text-muted-foreground/60">·</span>
          <span className="text-[10px] text-muted-foreground/70">{session.name}</span>
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
          <button
            type="button"
            onClick={toggleExpand}
            className="composer-icon-btn"
            title={expanded ? "Collapse" : "Expand"}
          >
            <HugeiconsIcon icon={expanded ? ArrowDownIcon : FullScreenIcon} size={12} strokeWidth={1.75} />
          </button>
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
            <div className="composer-avatar-lg">✦</div>
            <p className="text-[12px] font-medium text-foreground">What should I do?</p>
            <p className="text-[11px] text-muted-foreground/60">Ask about the open file, terminal output, or generate commands.</p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const isUser = msg.role === "user";
            const textParts = isUser ? msg.content : stripCodeBlocks(msg.content);
            const codeBlocks = isUser ? [] : parseCodeBlocks(msg.content);
            return (
              <div key={i} className={cn("composer-message", isUser ? "composer-message-user" : "composer-message-ai")}>
                {isUser ? (
                  <div className="composer-message-avatar" title="You">Y</div>
                ) : (
                  <div className="composer-message-avatar" title="Husk AI">
                    {msg.streaming ? <span className="composer-pulse-dot" /> : "✦"}
                  </div>
                )}
                <div className="composer-message-body">
                  <div className="composer-message-label">
                    {isUser ? (
                      <>
                        <span className="dot" />
                        <span>You</span>
                      </>
                    ) : (
                      <>
                        <span className="composer-message-role-icon">✦</span>
                        <span>Husk AI</span>
                      </>
                    )}
                  </div>
                  {isUser ? (
                    <div className="whitespace-pre-wrap text-[12px] text-foreground">{msg.content}</div>
                  ) : (
                    <>
                      {textParts && (
                        <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground/90">
                          {textParts}
                        </div>
                      )}
                      {codeBlocks.map((block, idx) => (
                        <div key={idx} className="composer-code-block">
                          <div className="composer-code-header">
                            <span className="lang">{block.lang}</span>
                            <button
                              type="button"
                              onClick={() => runCommand(block.code)}
                              className="composer-run-btn"
                            >
                              <HugeiconsIcon icon={ComputerTerminal02Icon} size={10} strokeWidth={1.75} />
                              Run
                            </button>
                          </div>
                          <pre className="composer-code-pre">
                            <code>{block.code}</code>
                          </pre>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}

        {busy && (!messages.length || messages[messages.length - 1].role !== "assistant" || messages[messages.length - 1].content) && (
          <div className="composer-message">
            <div className="composer-message-avatar">
              <span className="composer-pulse-dot" />
            </div>
            <div className="composer-message-body">
              <div className="composer-thinking">
                <span className="text-[12px] text-muted-foreground">Husk is thinking</span>
                <span className="composer-blob composer-blob-1" />
                <span className="composer-blob composer-blob-2" />
                <span className="composer-blob composer-blob-3" />
              </div>
            </div>
          </div>
        )}
      </div>

      {pendingRun && (
        <div className="composer-pending-run">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-amber-400">Run this command?</span>
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

      <div className="composer-input-toolbar">
        <button
          type="button"
          onClick={toggleVoice}
          className={cn("composer-input-toolbar-btn", listening && "recording")}
          title={listening ? "Stop listening" : "Voice input"}
        >
          <HugeiconsIcon icon={VoiceIcon} size={12} strokeWidth={1.75} />
          {listening ? "Listening…" : "Voice"}
        </button>
        <button
          type="button"
          onClick={handleFileUpload}
          className="composer-input-toolbar-btn"
          title="Attach file"
        >
          <HugeiconsIcon icon={AttachmentSquareIcon} size={12} strokeWidth={1.75} />
          Attach
        </button>
      </div>

      <div className="composer-input-row">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
            if (e.key === "Escape" && variant === "docked") {
              handleClose();
            }
          }}
          placeholder="Ask Husk..."
          rows={1}
          className="composer-textarea"
        />
        <button
          type="button"
          onClick={() => handleSend()}
          disabled={busy || !input.trim()}
          className="composer-send-btn"
        >
          {busy ? "…" : "Ask"}
        </button>
      </div>

      <div className="composer-footer">
        <div className="flex items-center gap-1.5">
          <span className="text-primary/60">●</span>
          <span>{provider.label} · {cfg.model || provider.defaultModel}</span>
          {currentFile && (
            <>
              <span>·</span>
              <span title={currentFile}>file context</span>
            </>
          )}
        </div>
        <div className="composer-footer-shortcut">
          <span className="composer-footer-kbd">Esc</span> close
          <span className="composer-footer-kbd">Ctrl+Shift+L</span> toggle
        </div>
      </div>
    </div>
  );
}
