import { useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, ComputerTerminal02Icon, PlusSignIcon, CommandIcon } from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { usePrefs } from "../settings/preferences";
import { loadConfig, getKey } from "../ai/store";
import { getProvider } from "../ai/providers";
import { streamChat } from "../ai/client";
import { getActiveAgent } from "../ai/agents";
import { readActiveTerminal, runInActiveTerminal } from "../ai/terminalContext";
import { registerComposerToggle, registerComposerOpen, registerComposerSend } from "../ai/bubbleStore";
import { getEditorFile, getEditorSelection } from "../ai/editorStore";
import { readFile } from "../fs";
import "./TerminalAiComposer.css";

interface CodeBlock {
  lang: string;
  code: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
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

/* ── Per-tab session store ──────────────────────────────────────────────── */

type ComposerSession = {
  messages: Message[];
  input: string;
};

const sessions = new Map<number, ComposerSession>();
const subscribers = new Set<() => void>();

function getSession(tabId: number): ComposerSession {
  if (!sessions.has(tabId)) {
    sessions.set(tabId, { messages: [], input: "" });
  }
  return sessions.get(tabId)!;
}

function updateSession(tabId: number, updater: (s: ComposerSession) => ComposerSession) {
  const next = updater(getSession(tabId));
  sessions.set(tabId, next);
  subscribers.forEach((fn) => fn());
}

function subscribeSessions(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function TerminalAiComposer({ activeTabId }: { activeTabId: number }) {
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const abortRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const handleSendRef = useRef<(textOverride?: string) => Promise<void>>(async () => {});

  const session = getSession(activeTabId);
  const messages = session.messages;
  const input = session.input;

  const setInput = (value: string) => {
    updateSession(activeTabId, (s) => ({ ...s, input: value }));
  };

  const setMessages = (updater: (prev: Message[]) => Message[]) => {
    updateSession(activeTabId, (s) => ({ ...s, messages: updater(s.messages) }));
  };

  useEffect(() => {
    return registerComposerToggle(() => setOpen((v) => !v));
  }, []);

  useEffect(() => {
    return registerComposerOpen((text) => {
      setOpen(true);
      if (text) {
        setInput(text);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    });
  }, []);

  useEffect(() => {
    return registerComposerSend((text) => {
      setOpen(true);
      setInput(text);
      setTimeout(() => {
        textareaRef.current?.focus();
        handleSendRef.current(text);
      }, 60);
    });
  }, []);

  // Re-render when any session changes
  useEffect(() => {
    subscribeSessions(() => setTick((v) => v + 1));
  }, []);

  // Auto-scroll to bottom on new messages
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
  }, [input, busy, messages, activeTabId]);

  useEffect(() => {
    handleSendRef.current = handleSend;
  }, [handleSend]);

  const handleClose = () => {
    abortRef.current = true;
    abortCtrlRef.current?.abort();
    setOpen(false);
    setBusy(false);
  };

  const newSession = () => {
    updateSession(activeTabId, () => ({ messages: [], input: "" }));
  };

  const runCommand = (cmd: string) => {
    runInActiveTerminal(cmd);
  };

  const cfg = loadConfig();
  const provider = cfg.providerId ? getProvider(cfg.providerId) : getProvider("openai");

  if (!open || !prefs.aiEnabled) return null;

  const currentFile = getEditorFile();
  const fileName = currentFile ? currentFile.split("/").pop() : null;

  const gap = prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined;

  return (
  <div
    className="composer-panel animate-composer-in"
    style={{
      maxHeight: messages.length ? 'min(40vh, 280px)' : 'auto',
      borderRadius: gap ? '16px' : '16px 16px 0 0',
    }}
  >
      {/* Gradient border glow line at top */}
      <div className="composer-glow" />

      {/* Header */}
      <div className="composer-header">
        <div className="flex items-center gap-2">
          <span className="composer-avatar">✦</span>
          <span className="text-[11px] font-semibold text-foreground">Husk AI</span>
          <span className="text-[10px] text-muted-foreground/60">·</span>
          <span className="text-[10px] text-muted-foreground/70">Tab {activeTabId}</span>
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
          <button
            type="button"
            onClick={newSession}
            className="composer-icon-btn"
            title="New session"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.75} />
          </button>
          <button type="button" onClick={handleClose} className="composer-icon-btn" title="Close">
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Messages */}
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
              <div key={i} className={cn("composer-message", isUser && "composer-message-user")}>
                {!isUser && (
                  <div className="composer-message-avatar">
                    {msg.streaming ? <span className="composer-pulse-dot" /> : "✦"}
                  </div>
                )}
                <div className="composer-message-body">
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
                            <span className="font-mono text-[9px] uppercase tracking-wider">{block.lang}</span>
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

      {/* Input */}
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
            if (e.key === "Escape") {
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

      {/* Footer info */}
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
