import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SparklesIcon,
  Cancel01Icon,
  MinusSignIcon,
  Clock01Icon,
  PlusSignIcon,
  PencilEdit02Icon,
  Copy01Icon,
  CopyCheckIcon,
  ComputerTerminal02Icon,
  ClipboardIcon,
  BugIcon,
  SearchList01Icon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons";
import { registerBubbleToggle } from "./bubbleStore";
import { toast } from "@/toast";
import { getProvider } from "./providers";
import { useKey } from "./store";
import { readActiveTerminal, runInActiveTerminal } from "./terminalContext";
import { useAiBubbleChat } from "./bubble/useAiBubbleChat";

type BubbleState = "collapsed" | "expanded";

const BUBBLE_SIZE = 44;
const PAD = 16;
const MIN_W = 280;
const MIN_H = 200;
const DEFAULT_W = 400;
const DEFAULT_H = 520;

function readBubblePos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem("husk.ai-bubble.pos");
    if (raw) {
      const p = JSON.parse(raw) as { x: number; y: number };
      if (typeof p.x === "number" && typeof p.y === "number") return p;
    }
  } catch {}
  return { x: window.innerWidth - BUBBLE_SIZE - PAD, y: window.innerHeight - BUBBLE_SIZE - PAD };
}

function saveBubblePos(p: { x: number; y: number }) {
  try {
    localStorage.setItem("husk.ai-bubble.pos", JSON.stringify(p));
  } catch {}
}

function readBubbleSize(): { w: number; h: number } {
  try {
    const raw = localStorage.getItem("husk.ai-bubble.size");
    if (raw) {
      const s = JSON.parse(raw) as { w: number; h: number };
      if (typeof s.w === "number" && typeof s.h === "number") return s;
    }
  } catch {}
  return { w: DEFAULT_W, h: DEFAULT_H };
}

function saveBubbleSize(s: { w: number; h: number }) {
  try {
    localStorage.setItem("husk.ai-bubble.size", JSON.stringify(s));
  } catch {}
}

/* ── Parse message into text / code segments ── */
interface MsgPart {
  type: "text" | "code";
  lang?: string;
  value: string;
}

function parseMessageParts(content: string): MsgPart[] {
  const result: MsgPart[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: "text", value: content.slice(lastIndex, match.index) });
    }
    result.push({ type: "code", lang: match[1] || "plaintext", value: match[2].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < content.length) {
    result.push({ type: "text", value: content.slice(lastIndex) });
  }
  if (result.length === 0) result.push({ type: "text", value: content });
  return result;
}

/* ── Code block with copy + run buttons ── */
function CodeBlock({ lang, value }: { lang: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Copy failed", variant: "error" });
    }
  };
  const handleRun = () => {
    if (runInActiveTerminal(value)) {
      toast({ title: "Sent to terminal", variant: "info" });
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };
  return (
    <div className="my-1.5 overflow-hidden rounded-lg border border-border/50 bg-black/40">
      <div className="flex items-center justify-between border-b border-border/30 bg-muted/20 px-2.5 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          {lang}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handleCopy}
            className="flex size-5 items-center justify-center rounded text-muted-foreground/60 hover:bg-muted/60 hover:text-foreground"
            title="Copy"
          >
            <HugeiconsIcon icon={copied ? CopyCheckIcon : Copy01Icon} size={11} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={handleRun}
            className="flex h-5 items-center gap-0.5 rounded px-1 text-[10px] text-emerald-500/80 hover:bg-emerald-500/10 hover:text-emerald-500"
            title="Run in terminal"
          >
            <HugeiconsIcon icon={ComputerTerminal02Icon} size={10} strokeWidth={1.5} />
            Run
          </button>
        </div>
      </div>
      <pre className="overflow-x-auto p-2 font-mono text-[10px] leading-relaxed text-foreground/90">
        <code>{value}</code>
      </pre>
    </div>
  );
}

/* ── Formatted message (text + code blocks) ── */
function FormattedBubbleMessage({ content, isStreaming }: { content: string; isStreaming: boolean }) {
  const parts = useMemo(() => parseMessageParts(content), [content]);
  return (
    <div className="flex flex-col gap-0.5">
      {parts.map((part, i) =>
        part.type === "code" ? (
          <CodeBlock key={i} lang={part.lang || "code"} value={part.value} />
        ) : (
          <div key={i} className="whitespace-pre-wrap text-[11px] leading-relaxed">
            {part.value}
          </div>
        )
      )}
      {isStreaming && <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary" />}
    </div>
  );
}


/* ── Quick actions triggered via /ai in terminal ── */
const QUICK_ACTIONS = [
  {
    id: "explain",
    label: "Explain Error",
    desc: "Find & explain the last error in your terminal",
    icon: BugIcon,
    prompt:
      "The last command I ran failed. Read the terminal buffer, find the error, and explain what went wrong + how to fix it.",
  },
  {
    id: "script",
    label: "Make Script",
    desc: "Turn recent commands into a .sh script",
    icon: SourceCodeIcon,
    prompt:
      "Look at my recent successful commands in this terminal and turn them into a clean, reusable shell script.",
  },
  {
    id: "summarize",
    label: "Summarize",
    desc: "Recap your recent terminal activity",
    icon: ClipboardIcon,
    prompt:
      "Recap my recent terminal activity — what commands I ran, what succeeded/failed, and what I'm working on.",
  },
  {
    id: "anomalies",
    label: "Find Issues",
    desc: "Scan output for errors & warnings",
    icon: SearchList01Icon,
    prompt:
      "Scan the current terminal output for errors, warnings, anomalies, or suspicious patterns I should know about.",
  },
];

/* ── Main component ── */
export function AiFloatingBubble({
  pendingQuery,
  mode = "terminal",
  onOpenAiPane,
}: {
  pendingQuery?: string;
  mode?: "terminal" | "editor";
  onOpenAiPane?: () => void;
}) {
  const [state, setState] = useState<BubbleState>("collapsed");
  const [pos, setPos] = useState(readBubblePos);
  const [size, setSize] = useState(readBubbleSize);
  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  posRef.current = pos;
  sizeRef.current = size;
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{
    sx: number; sy: number; sw: number; sh: number;
    spx: number; spy: number;
    edge: string;
  } | null>(null);
  const pendingRef = useRef<string | undefined>(undefined);

  // Dropdown states
  const [showSessions, setShowSessions] = useState(false);
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const editTitleRef = useRef<HTMLInputElement>(null);

  // Context preview tooltip
  const [showCtxPreview, setShowCtxPreview] = useState(false);
  const [ctxPreview, setCtxPreview] = useState("");

  const {
    messages,
    busy,
    send,
    stop,
    clear,
    includeContext,
    setIncludeContext,
    ensureSession,
    selectedProviderId,
    store: sessionStore,
    newSession,
    switchSession,
    deleteSession,
    renameSession,
  } = useAiBubbleChat();

  const provider = getProvider(selectedProviderId);
  const apiKey = useKey(provider.id);
  const needsKey = !provider.keyless && !apiKey;

  // Bubble toggle listener
  useEffect(() => {
    return registerBubbleToggle(() => {
      setState((s) => (s === "collapsed" ? "expanded" : "collapsed"));
    });
  }, []);

  // Window resize handler
  useEffect(() => {
    const onResize = () => {
      setPos((p) => ({
        x: Math.min(window.innerWidth - BUBBLE_SIZE, Math.max(0, p.x)),
        y: Math.min(window.innerHeight - BUBBLE_SIZE, Math.max(0, p.y)),
      }));
      setSize((s) => ({
        w: Math.min(window.innerWidth - 16, s.w),
        h: Math.min(window.innerHeight - 16, s.h),
      }));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, [messages]);

  // Handle pending query from terminal /ai command
  useEffect(() => {
    if (!pendingQuery || pendingQuery === pendingRef.current) return;
    pendingRef.current = pendingQuery;
    setState("expanded");
    ensureSession();
    void send(pendingQuery);
  }, [pendingQuery, send, ensureSession]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!showSessions && !showModelDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showSessions && !target.closest("[data-bubble-sessions]")) {
        setShowSessions(false);
      }
      if (showModelDropdown && !target.closest("[data-bubble-model]")) {
        setShowModelDropdown(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [showSessions, showModelDropdown]);

  // Context preview
  const refreshCtxPreview = () => {
    setCtxPreview(readActiveTerminal().slice(0, 500));
    setShowCtxPreview(true);
  };

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { ox: e.clientX - pos.x, oy: e.clientY - pos.y };
    const onMove = (ev: globalThis.MouseEvent) => {
      if (!dragRef.current) return;
      const nx = Math.min(window.innerWidth - BUBBLE_SIZE, Math.max(0, ev.clientX - dragRef.current.ox));
      const ny = Math.min(window.innerHeight - BUBBLE_SIZE, Math.max(0, ev.clientY - dragRef.current.oy));
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      saveBubblePos(posRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [pos]);

  const startResize = useCallback((edge: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      sx: e.clientX, sy: e.clientY, sw: size.w, sh: size.h,
      spx: pos.x, spy: pos.y, edge,
    };
    const onMove = (ev: globalThis.MouseEvent) => {
      if (!resizeRef.current) return;
      const r = resizeRef.current;
      const dx = ev.clientX - r.sx;
      const dy = ev.clientY - r.sy;
      let nw = r.sw;
      let nh = r.sh;
      let nx = r.spx;
      let ny = r.spy;

      if (r.edge.includes("e")) nw = Math.max(MIN_W, r.sw + dx);
      if (r.edge.includes("w")) {
        const candidate = Math.max(MIN_W, r.sw - dx);
        nw = candidate;
        nx = r.spx + (r.sw - candidate);
      }
      if (r.edge.includes("s")) nh = Math.max(MIN_H, r.sh + dy);
      if (r.edge.includes("n")) {
        const candidate = Math.max(MIN_H, r.sh - dy);
        nh = candidate;
        ny = r.spy + (r.sh - candidate);
      }

      nw = Math.min(nw, window.innerWidth - 8);
      nh = Math.min(nh, window.innerHeight - 8);
      nx = Math.max(0, Math.min(nx, window.innerWidth - nw - 8));
      ny = Math.max(0, Math.min(ny, window.innerHeight - nh - 8));

      setSize({ w: nw, h: nh });
      setPos({ x: nx, y: ny });
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      saveBubbleSize(sizeRef.current);
      saveBubblePos(posRef.current);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [size, pos]);

  const handleClose = () => {
    setState("collapsed");
    clear();
  };

  const handleQuickAction = (prompt: string) => {
    if (needsKey || busy) return;
    ensureSession();
    void send(prompt);
  };

  if (state === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => {
          if (mode === "editor" && onOpenAiPane) {
            onOpenAiPane();
          } else {
            setState("expanded");
          }
        }}
        className="fixed z-50 flex items-center justify-center rounded-full border border-primary/40 bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:scale-110 hover:bg-primary active:scale-95 focus:outline-none focus:ring-0"
        style={{
          right: PAD,
          bottom: 52,
          width: BUBBLE_SIZE,
          height: BUBBLE_SIZE,
        }}
        aria-label={mode === "editor" ? "Open AI panel" : "Open AI chat"}
        title={mode === "editor" ? "Open AI panel" : "AI Chat"}
      >
        <HugeiconsIcon icon={SparklesIcon} size={20} strokeWidth={1.5} />
      </button>
    );
  }

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl shadow-black/40"
      style={{
        left: pos.x,
        top: pos.y,
        width: size.w,
        height: size.h,
      }}
    >
      {/* Resize strips */}
      <div className="absolute top-0 left-2 right-2 z-20 cursor-ns-resize" style={{ height: 4 }} onMouseDown={startResize("n")} />
      <div className="absolute bottom-0 left-2 right-2 z-20 cursor-ns-resize" style={{ height: 4 }} onMouseDown={startResize("s")} />
      <div className="absolute top-2 bottom-2 left-0 z-20 cursor-ew-resize" style={{ width: 4 }} onMouseDown={startResize("w")} />
      <div className="absolute top-2 bottom-2 right-0 z-20 cursor-ew-resize" style={{ width: 4 }} onMouseDown={startResize("e")} />
      <div className="absolute top-0 left-0 z-20 size-2 cursor-nwse-resize" onMouseDown={startResize("nw")} />
      <div className="absolute top-0 right-0 z-20 size-2 cursor-nesw-resize" onMouseDown={startResize("ne")} />
      <div className="absolute bottom-0 left-0 z-20 size-2 cursor-nesw-resize" onMouseDown={startResize("sw")} />
      <div className="absolute bottom-0 right-0 z-20 size-3 cursor-nwse-resize" onMouseDown={startResize("se")}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="pointer-events-none text-muted-foreground/40">
          <path d="M7 11L11 7M11 11L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M4 11L11 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
        </svg>
      </div>

      {/* ── HEADER ── */}
      <div
        className={cn(
          "relative flex shrink-0 cursor-move items-center gap-1.5 border-b border-border/60 bg-muted/30 px-2.5 py-1.5 select-none",
          busy && "header-streaming"
        )}
        onMouseDown={startDrag}
      >
        {/* Status dot */}
        <div
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            busy ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
          )}
          title={busy ? "Streaming…" : "Ready"}
        />
        <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={1.5} className="shrink-0 text-primary" />
        <span className="mr-auto text-[11px] font-semibold text-foreground">AI</span>

        {/* Provider label (read-only, synced from Settings) */}
        <span className="shrink-0 rounded-md border border-border/40 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {provider.label.split(" ")[0]}
        </span>

        {/* Context chip */}
        <button
          type="button"
          onClick={() => setIncludeContext((v) => !v)}
          onMouseEnter={refreshCtxPreview}
          onMouseLeave={() => setShowCtxPreview(false)}
          className={cn(
            "relative flex h-5 shrink-0 items-center gap-0.5 rounded-md border px-1.5 text-[10px] transition-colors",
            includeContext
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
              : "border-border/40 bg-muted/40 text-muted-foreground hover:bg-muted/70"
          )}
          title={includeContext ? "Terminal context ON" : "Terminal context OFF"}
        >
          <HugeiconsIcon icon={ClipboardIcon} size={10} strokeWidth={1.5} />
          <span>{includeContext ? "Ctx" : "No ctx"}</span>
          {/* Context preview tooltip */}
          {showCtxPreview && includeContext && ctxPreview && (
            <div className="absolute top-full right-0 z-40 mt-1.5 w-64 rounded-md border border-border/60 bg-popover p-2 shadow-lg">
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Terminal context preview</div>
              <pre className="max-h-32 overflow-auto rounded bg-black/30 p-1.5 font-mono text-[9px] text-foreground/70">{ctxPreview}</pre>
            </div>
          )}
        </button>

        {/* Session menu */}
        <div className="relative shrink-0" data-bubble-sessions>
          <button
            type="button"
            onClick={() => setShowSessions((v) => !v)}
            className="relative flex h-5 items-center gap-0.5 rounded-md border border-border/40 bg-muted/40 px-1.5 text-[10px] text-foreground hover:bg-muted/70"
            title="Chat sessions"
          >
            <HugeiconsIcon icon={Clock01Icon} size={10} strokeWidth={1.5} />
            {sessionStore.sessions.length > 0 && (
              <span className="flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-primary/20 px-1 text-[9px] text-primary">
                {sessionStore.sessions.length}
              </span>
            )}
          </button>
          {showSessions && (
            <div className="absolute top-full right-0 z-30 mt-1 w-60 rounded-md border border-border/60 bg-popover py-1 shadow-lg">
              <div className="flex items-center justify-between px-2 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sessions</span>
                <button
                  type="button"
                  onClick={newSession}
                  className="flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-primary hover:bg-primary/10"
                >
                  <HugeiconsIcon icon={PlusSignIcon} size={10} strokeWidth={2} />
                  New
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {sessionStore.sessions.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">No sessions yet</div>
                )}
                {sessionStore.sessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      "group flex items-center gap-1.5 px-2 py-1.5",
                      session.id === sessionStore.activeSessionId ? "bg-accent/10" : "hover:bg-muted/50"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => switchSession(session.id)}
                      className="flex-1 truncate text-left text-[11px] text-foreground"
                      title={session.title}
                    >
                      {session.title}
                    </button>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditingTitle(session.id); }}
                        className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                        title="Rename"
                      >
                        <HugeiconsIcon icon={PencilEdit02Icon} size={10} strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteSession(session.id); }}
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

        {/* Stop button (streaming only) */}
        {busy && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); stop(); }}
            className="flex size-5 shrink-0 items-center justify-center rounded bg-destructive/10 text-destructive hover:bg-destructive/20"
            title="Stop generating"
          >
            <div className="size-2 rounded-sm bg-current" />
          </button>
        )}

        {/* Minimize */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setState("collapsed"); }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Minimize"
        >
          <HugeiconsIcon icon={MinusSignIcon} size={12} strokeWidth={1.75} />
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Close"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>

        {/* Rename modal */}
        {editingTitle && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setEditingTitle(null)}>
            <div className="w-64 rounded-lg border border-border bg-popover p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
              <div className="mb-2 text-[12px] font-medium text-foreground">Rename session</div>
              <input
                ref={editTitleRef}
                defaultValue={sessionStore.sessions.find((s) => s.id === editingTitle)?.title ?? ""}
                className="mb-3 h-8 w-full rounded border border-border/40 bg-muted/50 px-2 text-[12px] text-foreground outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameSession(editingTitle, (e.target as HTMLInputElement).value);
                    setEditingTitle(null);
                  } else if (e.key === "Escape") {
                    setEditingTitle(null);
                  }
                }}
                autoFocus
              />
              <div className="flex justify-end gap-1.5">
                <button type="button" onClick={() => setEditingTitle(null)} className="rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">Cancel</button>
                <button
                  type="button"
                  onClick={() => { renameSession(editingTitle, editTitleRef.current?.value ?? ""); setEditingTitle(null); }}
                  className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── MESSAGES ── */}
      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
              <HugeiconsIcon icon={SparklesIcon} size={18} strokeWidth={1.5} className="text-primary" />
            </div>
            <div className="max-w-[220px] text-center text-[12px] leading-relaxed text-muted-foreground">
              Type <code className="rounded bg-muted px-1 py-0.5 text-primary">/ai</code> in your terminal to ask questions. Responses appear here.
            </div>
            <div className="grid w-full grid-cols-2 gap-1.5 px-1">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => handleQuickAction(action.prompt)}
                  disabled={busy || needsKey}
                  className="flex flex-col items-center gap-1 rounded-lg border border-border/40 bg-muted/20 px-2 py-2.5 text-foreground transition-colors hover:bg-muted/50 disabled:opacity-40"
                >
                  <HugeiconsIcon icon={action.icon} size={14} strokeWidth={1.5} className="text-muted-foreground" />
                  <span className="text-[11px] font-medium">{action.label}</span>
                  <span className="px-1 text-center text-[9px] leading-tight text-muted-foreground/60">{action.desc}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[92%] rounded-lg px-3 py-2",
                    m.role === "user"
                      ? "bg-primary/10 text-foreground"
                      : "bg-muted/30 text-foreground"
                  )}
                >
                  {m.role === "user" ? (
                    <span className="text-[12px] leading-relaxed">{m.content}</span>
                  ) : (
                    <FormattedBubbleMessage
                      content={m.content}
                      isStreaming={busy && i === messages.length - 1}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── FOOTER ── */}
      <div className="shrink-0 border-t border-border/60 bg-muted/10 px-2.5 py-2">
        {needsKey ? (
          <div className="rounded-md bg-muted/30 px-3 py-2 text-center text-[11px] text-muted-foreground">
            Set a {provider.label} API key in{" "}
            <span className="text-primary">Settings → Models</span>
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg border border-border/40 bg-muted/20 py-2 text-[11px] text-muted-foreground">
            Type{" "}
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-primary">/ai</code>{" "}
            in the terminal to chat
          </div>
        )}
      </div>
    </div>
  );
}
