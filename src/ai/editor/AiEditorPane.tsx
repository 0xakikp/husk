import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SparklesIcon,
  Cancel01Icon,
  Delete02Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  Tick02Icon,
  File01Icon,
  WrenchIcon,
  BugIcon,
  TestTubeIcon,
  FileEditIcon,
  SearchList01Icon,
  CancelCircleIcon,
  Clock01Icon,
  PlusSignIcon,
  PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { PROVIDERS, getProvider } from "../providers";
import { loadConfig, useKey } from "../store";
import { useAgents, useActiveAgentId, setActiveAgent } from "../agents";
import { useAiEditorChat } from "./useAiEditorChat";
import { QUICK_ACTIONS } from "./types";
import type { EditorChatMessage, CodeEdit } from "./types";
import { stripEditBlocks } from "./editorStore";
import {
  getWorkspaceKey,
  loadSessions,
  saveSessions,
  createSession,
  setActiveSession,
  updateSessionMessages,
  updateSessionTitle,
  deleteSession,
} from "./sessionStore";

const ACTION_ICON: Record<string, typeof SparklesIcon> = {
  explain: File01Icon,
  refactor: WrenchIcon,
  fix: BugIcon,
  test: TestTubeIcon,
  docs: FileEditIcon,
  review: SearchList01Icon,
};

function ChatMessageView({ msg, isLast }: { msg: EditorChatMessage; isLast: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={cn("flex flex-col gap-1 px-3 py-2", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[92%] rounded-lg px-3 py-2 text-[13px] leading-relaxed",
          isUser ? "bg-primary/10 text-foreground" : "bg-transparent text-foreground"
        )}
      >
        {isUser ? (
          <span>{msg.content}</span>
        ) : (
          <FormattedMessage content={msg.content} isStreaming={isLast && !msg.content} />
        )}
      </div>
    </div>
  );
}

function FormattedMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const prose = useMemo(() => stripEditBlocks(content), [content]);
  const parts = useMemo(() => {
    const result: { type: "text" | "code"; lang?: string; value: string }[] = [];
    const regex = /```(\w*)\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prose)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: "text", value: prose.slice(lastIndex, match.index) });
      }
      result.push({ type: "code", lang: match[1] || "plaintext", value: match[2].trim() });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < prose.length) {
      result.push({ type: "text", value: prose.slice(lastIndex) });
    }
    if (result.length === 0) result.push({ type: "text", value: prose });
    return result;
  }, [prose]);

  return (
    <div className="flex flex-col gap-2">
      {parts.map((part, i) =>
        part.type === "code" ? (
          <div key={i} className="overflow-x-auto rounded-md bg-black/30 p-2.5">
            {part.lang && part.lang !== "plaintext" ? (
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground/50">{part.lang}</div>
            ) : null}
            <pre className="font-mono text-[12px] leading-relaxed text-foreground/90">
              <code>{part.value}</code>
            </pre>
          </div>
        ) : (
          <div key={i} className="whitespace-pre-wrap">{part.value}</div>
        )
      )}
      {isStreaming && <span className="inline-block h-4 w-1 animate-pulse bg-primary" />}
    </div>
  );
}

function EditCard({
  edit,
  index,
  onAccept,
  onReject,
}: {
  edit: CodeEdit;
  index: number;
  onAccept: (i: number) => void;
  onReject: (i: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <span className="truncate text-[11px] font-medium text-foreground">
          {edit.file || "Current file"}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onAccept(index)}
            className="flex size-5 items-center justify-center rounded text-emerald-500 hover:bg-emerald-500/10"
            title="Accept"
          >
            <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => onReject(index)}
            className="flex size-5 items-center justify-center rounded text-destructive hover:bg-destructive/10"
            title="Reject"
          >
            <HugeiconsIcon icon={CancelCircleIcon} size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-1 text-[10px] text-muted-foreground hover:text-foreground"
      >
        {expanded ? "Hide diff" : "Show diff"}
      </button>
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1 font-mono text-[10px]">
          <div className="rounded bg-red-500/10 p-1.5 text-red-400">
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-red-400/60">Remove</div>
            <pre className="whitespace-pre-wrap">{edit.search}</pre>
          </div>
          <div className="rounded bg-emerald-500/10 p-1.5 text-emerald-400">
            <div className="mb-0.5 text-[9px] uppercase tracking-wider text-emerald-400/60">Add</div>
            <pre className="whitespace-pre-wrap">{edit.replace}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

export function AiEditorPane({
  activePath,
  openFiles,
  onClose,
}: {
  activePath: string | null;
  openFiles: { path: string; name: string }[];
  onClose: () => void;
}) {
  const workspace = getWorkspaceKey(activePath);
  const [store, setStore] = useState(() => loadSessions(workspace));
  const [showSessions, setShowSessions] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const editTitleRef = useRef<HTMLInputElement>(null);

  const activeSession = store.sessions.find((s) => s.id === store.activeSessionId) ?? null;

  const {
    messages,
    input,
    setInput,
    busy,
    send,
    clear,
    resetMessages,
    pendingEdits,
    appliedCount,
    applyAll,
    rejectAll,
    applyOne,
    rejectOne,
  } = useAiEditorChat(activePath, openFiles.map((f) => f.path));

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showQuickActions, setShowQuickActions] = useState(true);

  const cfg = loadConfig();
  const provider = getProvider(cfg.providerId);
  const apiKey = useKey(provider.id);
  const needsKey = !provider.keyless && !apiKey;

  const agents = useAgents();
  const activeAgentId = useActiveAgentId();

  // Track which session's messages are currently loaded so we don't overwrite on create/save
  const loadedSessionIdRef = useRef<string | null>(null);

  // Load messages when active session changes (initial mount + user switches)
  useEffect(() => {
    if (activeSession) {
      if (loadedSessionIdRef.current !== activeSession.id) {
        loadedSessionIdRef.current = activeSession.id;
        resetMessages(activeSession.messages);
      }
    } else {
      loadedSessionIdRef.current = null;
      resetMessages([]);
    }
  }, [activeSession, resetMessages]);

  // Persist messages after each change (and auto-title from first user message)
  useEffect(() => {
    if (!activeSession) return;
    let currentStore = store;

    // Auto-title session from the first user message
    if (messages.length > 0 && messages[0].role === "user" && activeSession.title === "New Chat") {
      const autoTitle = messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? "…" : "");
      currentStore = updateSessionTitle(currentStore, activeSession.id, autoTitle);
    }

    const next = updateSessionMessages(currentStore, activeSession.id, messages);
    setStore(next);
    saveSessions(workspace, next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Close session dropdown on outside click
  useEffect(() => {
    if (!showSessions) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-session-dropdown]")) {
        setShowSessions(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showSessions]);

  const handleNewChat = useCallback(() => {
    const session = createSession();
    const next = {
      activeSessionId: session.id,
      sessions: [session, ...store.sessions],
    };
    setStore(next);
    saveSessions(workspace, next);
    loadedSessionIdRef.current = session.id;
    resetMessages([]);
    setShowSessions(false);
  }, [store, workspace, resetMessages]);

  const handleSwitchSession = useCallback((id: string) => {
    const next = setActiveSession(store, id);
    setStore(next);
    saveSessions(workspace, next);
    setShowSessions(false);
  }, [store, workspace]);

  const handleDeleteSession = useCallback((id: string) => {
    const next = deleteSession(store, id);
    setStore(next);
    saveSessions(workspace, next);
  }, [store, workspace]);

  const handleRenameSession = useCallback((id: string, title: string) => {
    const next = updateSessionTitle(store, id, title);
    setStore(next);
    saveSessions(workspace, next);
    setEditingTitle(null);
  }, [store, workspace]);

  const ensureSession = useCallback(() => {
    if (activeSession) return;
    const session = createSession();
    const next = {
      activeSessionId: session.id,
      sessions: [session, ...store.sessions],
    };
    setStore(next);
    saveSessions(workspace, next);
    loadedSessionIdRef.current = session.id;
    resetMessages([]);
  }, [activeSession, store, workspace, resetMessages]);

  const handleSend = () => {
    if (needsKey) return;
    ensureSession();
    void send();
  };

  const handleQuickAction = (prompt: string) => {
    if (needsKey) return;
    ensureSession();
    void send(prompt);
  };

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/40 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <HugeiconsIcon icon={SparklesIcon} size={14} strokeWidth={1.5} className="text-primary" />
          <span className="text-[12px] font-semibold text-foreground">AI</span>
        </div>
        <div className="flex items-center gap-0.5">
          {/* Session history dropdown */}
          <div className="relative" data-session-dropdown>
            <button
              type="button"
              onClick={() => setShowSessions((v) => !v)}
              className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Chat history"
            >
              <HugeiconsIcon icon={Clock01Icon} size={14} strokeWidth={1.5} />
            </button>
            {showSessions && (
              <div className="absolute top-full right-0 z-30 mt-1 w-56 rounded-md border border-border/60 bg-popover py-1 shadow-lg">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sessions</span>
                  <button
                    type="button"
                    onClick={handleNewChat}
                    className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                  >
                    <HugeiconsIcon icon={PlusSignIcon} size={10} strokeWidth={2} />
                    New
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {store.sessions.length === 0 && (
                    <div className="px-3 py-2 text-[11px] text-muted-foreground">No sessions yet</div>
                  )}
                  {store.sessions.map((session) => (
                    <div
                      key={session.id}
                      className={cn(
                        "group flex items-center gap-1.5 px-2 py-1.5",
                        session.id === store.activeSessionId ? "bg-accent/10" : "hover:bg-muted/50"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => handleSwitchSession(session.id)}
                        className="flex-1 truncate text-left text-[11px] text-foreground"
                        title={session.title}
                      >
                        {session.title}
                      </button>
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingTitle(session.id);
                          }}
                          className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                          title="Rename"
                        >
                          <HugeiconsIcon icon={PencilEdit02Icon} size={10} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteSession(session.id);
                          }}
                          className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {/* Session title editor overlay */}
          {editingTitle && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-64 rounded-lg border border-border bg-popover p-3 shadow-lg">
                <div className="mb-2 text-[12px] font-medium text-foreground">Rename session</div>
                <input
                  ref={editTitleRef}
                  defaultValue={store.sessions.find((s) => s.id === editingTitle)?.title ?? ""}
                  className="mb-3 h-8 w-full rounded border border-border/40 bg-muted/50 px-2 text-[12px] text-foreground outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleRenameSession(editingTitle, (e.target as HTMLInputElement).value);
                    } else if (e.key === "Escape") {
                      setEditingTitle(null);
                    }
                  }}
                  autoFocus
                />
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setEditingTitle(null)}
                    className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const val = editTitleRef.current?.value ?? "";
                      handleRenameSession(editingTitle, val);
                    }}
                    className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90"
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={clear}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Clear chat"
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Model + Agent selectors */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-hidden border-b border-border/40 px-3 py-1.5">
        <select
          className="h-6 min-w-0 flex-1 rounded border-0 bg-muted/50 px-1.5 text-[11px] text-foreground outline-none ring-0"
          style={{ width: 0, maxWidth: "100%" }}
          value={cfg.providerId}
          disabled
          title="Provider (change in Settings)"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className="h-6 min-w-0 flex-1 rounded border-0 bg-muted/50 px-1.5 text-[11px] text-foreground outline-none ring-0"
          style={{ width: 0, maxWidth: "100%" }}
          value={activeAgentId}
          onChange={(e) => setActiveAgent(e.target.value)}
          title="Agent"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="no-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        {messages.length === 0 ? (
          <div className="flex h-full min-w-0 flex-col items-center justify-center gap-4 px-3 py-8">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
              <HugeiconsIcon icon={SparklesIcon} size={18} strokeWidth={1.5} className="text-primary" />
            </div>
            <div className="text-center text-[13px] leading-relaxed text-muted-foreground">
              Ask me to explain, refactor, fix, or generate code. I know the current file you are editing.
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <ChatMessageView key={msg.id} msg={msg} isLast={i === messages.length - 1} />
          ))
        )}
      </div>

      {/* Pending edits */}
      {pendingEdits.length > 0 && (
        <div className="shrink-0 border-t border-border/40 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              {pendingEdits.length} suggested edit{pendingEdits.length > 1 ? "s" : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={applyAll}
                className="rounded bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500 hover:bg-emerald-500/20"
              >
                Accept all
              </button>
              <button
                type="button"
                onClick={rejectAll}
                className="rounded bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/20"
              >
                Reject all
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            {pendingEdits.map((edit, i) => (
              <EditCard key={i} edit={edit} index={i} onAccept={applyOne} onReject={rejectOne} />
            ))}
          </div>
        </div>
      )}

      {appliedCount > 0 && pendingEdits.length === 0 && (
        <div className="shrink-0 border-t border-border/40 px-3 py-1.5 text-center text-[11px] text-emerald-500">
          {appliedCount} change{appliedCount > 1 ? "s" : ""} applied
        </div>
      )}

      {/* Quick actions */}
      {showQuickActions && messages.length === 0 && activePath && (
        <div className="shrink-0 border-t border-border/40 px-3 py-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Quick actions</span>
            <button
              type="button"
              onClick={() => setShowQuickActions(false)}
              className="text-muted-foreground/40 hover:text-muted-foreground"
            >
              <HugeiconsIcon icon={ArrowDown01Icon} size={12} strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {QUICK_ACTIONS.map((action) => {
              const Icon = ACTION_ICON[action.id] || SparklesIcon;
              return (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={busy || needsKey}
                  className="inline-flex items-center gap-1 rounded-md border border-border/40 bg-muted/30 px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted/60 disabled:opacity-40"
                >
                  <HugeiconsIcon icon={Icon} size={12} strokeWidth={1.5} className="text-muted-foreground" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-border/40 p-2">
        {needsKey ? (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-center text-[12px] text-muted-foreground">
            Set a {provider.label} API key in{" "}
            <span className="text-primary">Settings → Models</span>
          </div>
        ) : (
          <div className="flex items-end gap-1.5 rounded-lg border border-border/40 bg-muted/20 p-1.5">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask about this file..."
              rows={2}
              className="min-h-[36px] w-full resize-none border-0 bg-transparent px-1.5 py-1 text-[13px] text-foreground outline-none ring-0 placeholder:text-muted-foreground/40"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={busy || !input.trim()}
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary transition-colors hover:bg-primary/20 disabled:opacity-30"
            >
              <HugeiconsIcon icon={ArrowUp01Icon} size={14} strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
