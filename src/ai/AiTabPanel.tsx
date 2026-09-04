import { useState, useEffect, useRef, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlusSignIcon,
  MessageMultiple02Icon,
  Archive02Icon,
  Delete02Icon,
  Search01Icon,
  Settings01Icon,
  PencilEdit01Icon,
  FullScreenIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { TerminalAiComposer } from "../terminal/TerminalAiComposer";
import { usePrefs, setPrefs } from "../settings/preferences";
import {
  useSessions,
  useActiveSessionId,
  setActiveSessionId,
  createSession,
  deleteSession,
  archiveSession,
  unarchiveSession,
  getSession,
  ensureSession,
  updateSession,
  isTabSessionId,
  type AiSession,
} from "./sessionStore";
import { getPendingEdits, subscribePendingEdits } from "./pendingEdits";

function groupDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86400000;
  const startOfWeek = startOfToday - now.getDay() * 86400000;

  if (ts >= startOfToday) return "Today";
  if (ts >= startOfYesterday) return "Yesterday";
  if (ts >= startOfWeek) return "This week";
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "long" });
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let ti = 0;
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i], ti);
    if (idx === -1) return false;
    ti = idx + 1;
  }
  return true;
}

function sessionPreview(messages: { role: string; content: string }[]): string {
  const last = [...messages].reverse().find((m) => m.content?.trim());
  if (!last) return "No messages yet";
  const text = last.content.trim().split("\n")[0].slice(0, 42);
  return text.length < last.content.trim().length ? text + "…" : text;
}

export function AiTabPanel({
  onReturnToTerminal,
  onClose,
}: {
  onReturnToTerminal: (session: AiSession) => void;
  onClose: () => void;
}) {
  const sessions = useSessions();
  const activeId = useActiveSessionId();
  const prefs = usePrefs();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [pendingEdits, setPendingEdits] = useState(getPendingEdits);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resizable session sidebar
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarDragRef = useRef(false);
  const sidebarWidthRef = useRef(prefs.aiSidebarWidth ?? 240);
  const [sidebarWidth, setSidebarWidth] = useState(sidebarWidthRef.current);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!sidebarDragRef.current || !sidebarRef.current) return;
      const left = sidebarRef.current.getBoundingClientRect().left;
      const next = Math.min(380, Math.max(160, Math.round(e.clientX - left)));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };
    const onUp = () => {
      if (!sidebarDragRef.current) return;
      sidebarDragRef.current = false;
      setPrefs({ aiSidebarWidth: sidebarWidthRef.current });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  useEffect(() => subscribePendingEdits(() => setPendingEdits(getPendingEdits())), []);

  // Ensure a global session exists for the AI tab itself
  useEffect(() => {
    ensureSession("global", { name: "AI Chat", source: "ai-tab" });
    if (!activeId) {
      setActiveSessionId("global");
    }
  }, [activeId]);

  const activeSession = activeId ? getSession(activeId) : getSession("global");

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return sessions;
    return sessions.filter((s) => fuzzyMatch(q, s.name) || fuzzyMatch(q, sessionPreview(s.messages)));
  }, [sessions, query]);

  const activeList = filtered.filter((s) => !s.archived);
  const archivedList = filtered.filter((s) => s.archived);

  const groupedActive = useMemo(() => {
    const groups = new Map<string, typeof activeList>();
    for (const s of activeList) {
      const g = groupDate(s.updatedAt);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(s);
    }
    return Array.from(groups.entries());
  }, [activeList]);

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      updateSession(editingId, (s) => ({ ...s, name: editName.trim() }));
    }
    setEditingId(null);
  };

  const sessionRow = (s: typeof sessions[0], isArchived = false) => {
    const isActive = activeSession.id === s.id;
    const isTerminal = isTabSessionId(s.id);
    const preview = sessionPreview(s.messages);
    const streaming = s.messages.some((message) => message.streaming);
    const proposedEdits = pendingEdits.filter((edit) => edit.sessionId === s.id).length;
    const hasFailureEvidence = s.messages.some((message) =>
      message.trace?.context.some((item) => /\bexit\s+[1-9]\d*\b/i.test(item.label)),
    );
    const state = streaming
      ? { label: "thinking", className: "border-sky-400/25 text-sky-400/75" }
      : proposedEdits > 0
        ? { label: `${proposedEdits} edit${proposedEdits > 1 ? "s" : ""}`, className: "border-primary/25 text-primary/80" }
        : hasFailureEvidence
          ? { label: "failure context", className: "border-amber-400/25 text-amber-400/75" }
          : null;
    /* The active row permanently reserves room for three actions. Derive the
       session chrome from the measured sidebar width so a long status label
       cannot survive into that reserved space while the user drags narrower. */
    const compactSessionStatus = sidebarWidth < 360;
    const showTerminalBadge = sidebarWidth >= 280;
    const statusLabel = state
      ? compactSessionStatus
        ? state.label === "failure context" ? "!" : state.label.replace(/\s+context$/, "")
        : state.label
      : "";
    return (
      <div
        key={s.id}
        className={cn(
          "ai-session-row group relative flex min-w-0 items-start gap-2 rounded-md border px-2 py-1 font-mono text-[11px] transition-all",
          isActive
            ? "border-primary/60 bg-primary/[0.07] text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        )}
      >
        {editingId === s.id ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditingId(null);
            }}
            className="flex-1 min-w-0 bg-transparent text-foreground outline-none"
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => setActiveSessionId(s.id)}
              className="flex flex-1 min-w-0 flex-col items-start text-left"
            >
              <span className="ai-session-row-title flex min-w-0 w-full items-center gap-1.5">
                <span
                  className={cn(
                    "shrink-0 text-[10px] transition-colors",
                    isActive
                      ? isTerminal ? "text-emerald-400" : "text-violet-400"
                      : "text-muted-foreground/40 group-hover:text-muted-foreground"
                  )}
                >
                  {isTerminal ? "▸" : "✦"}
                </span>
                <span className="truncate font-medium">{s.name}</span>
                {isTerminal && showTerminalBadge && (
                  <span className="ai-session-terminal-badge shrink-0 rounded border border-emerald-400/20 px-1 py-px text-[7px] font-medium uppercase tracking-wide text-emerald-400/70">
                    terminal
                  </span>
                )}
                {state && (
                  <span
                    className={cn(
                      "ai-session-state-badge shrink-0 rounded border px-1 py-px text-[7px] font-medium uppercase tracking-wide",
                      state.className,
                    )}
                    title={state.label === "failure context" ? "This chat included failed terminal output as context" : state.label}
                  >
                    {statusLabel}
                  </span>
                )}
              </span>
              <span className="ml-4 mt-px text-[9px] text-muted-foreground/45 group-hover:text-muted-foreground/60 transition-colors line-clamp-1">
                {preview}
              </span>
            </button>

            {/* actions — hidden until hover/selected */}
            <div className={cn("ai-session-row-actions flex items-center gap-0.5 shrink-0", !isActive && "opacity-0 group-hover:opacity-100 transition-opacity")}>
              <button
                type="button"
                onClick={() => startRename(s.id, s.name)}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                title="Rename"
              >
                <HugeiconsIcon icon={PencilEdit01Icon} size={9} strokeWidth={1.75} />
              </button>
              {isArchived ? (
                <button
                  type="button"
                  onClick={() => unarchiveSession(s.id)}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                  title="Unarchive"
                >
                  <HugeiconsIcon icon={Archive02Icon} size={9} strokeWidth={1.75} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => archiveSession(s.id)}
                  className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                  title="Archive"
                >
                  <HugeiconsIcon icon={Archive02Icon} size={9} strokeWidth={1.75} />
                </button>
              )}
              <button
                type="button"
                onClick={() => deleteSession(s.id)}
                className="inline-flex size-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-destructive/15 hover:text-destructive"
                title="Delete"
              >
                <HugeiconsIcon icon={Delete02Icon} size={9} strokeWidth={1.75} />
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      {/* Session sidebar */}
      {!focusMode && <div
        ref={sidebarRef}
        className="ai-session-sidebar relative flex h-full shrink-0 flex-col border-r border-border/50 bg-background/95"
        style={{ width: sidebarWidth }}
      >
        {/* drag-to-resize handle */}
        <div
          className="husk-resize-seam husk-resize-seam-vertical absolute -right-[6px] top-0 bottom-0 z-30 w-3 cursor-ew-resize touch-none"
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            sidebarDragRef.current = true;
          }}
          title="Drag to resize"
        />
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/50 px-3">
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-semibold text-foreground tracking-tight">
            <HugeiconsIcon icon={MessageMultiple02Icon} size={13} strokeWidth={1.75} />
            ai-chats
          </span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setFocusMode(true)}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              title="Focus conversation"
            >
              <HugeiconsIcon icon={FullScreenIcon} size={11} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              onClick={() => {
                const s = createSession({ source: "ai-tab" });
                setActiveSessionId(s.id);
              }}
              className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary transition-colors"
              title="New chat"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.75} />
            </button>
          </div>
        </div>
        <div className="px-2 pt-2">
          <div className="relative">
            <HugeiconsIcon icon={Search01Icon} size={11} strokeWidth={1.75} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/40" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="/ search sessions…"
              className="h-7 w-full box-border rounded-md border border-border/50 bg-muted/20 pl-7 pr-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/40 focus:border-primary/50 focus:bg-muted/40 transition-colors"
            />
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
          {groupedActive.length === 0 ? (
            <div className="px-2 py-6 text-center text-[10px] text-muted-foreground/40">
              {query.trim() ? "No matching chats" : "No chats yet"}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {groupedActive.map(([group, items]) => (
                <div key={group} className="flex flex-col gap-0.5">
                  <div className="px-2 pb-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/35">
                    {group}
                  </div>
                  {items.map((s) => sessionRow(s))}
                </div>
              ))}
            </div>
          )}

          {archivedList.length > 0 && (
            <div className="mt-3 pt-2 border-t border-border/30">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="flex w-full items-center justify-between px-2 py-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
              >
                <span>Archived ({archivedList.length})</span>
                <span className="text-[8px]">{showArchived ? "▾" : "▸"}</span>
              </button>
              {showArchived && (
                <div className="flex flex-col gap-0.5 mt-1 opacity-70">
                  {archivedList.map((s) => sessionRow(s, true))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>}

      {/* Chat area */}
      {/* This is a vertical flex boundary for the full composer. Without
          min-h-0, a long transcript can make the composer grow past this pane
          and the AI tab's outer overflow clips its connection footer. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {prefs.aiEnabled ? (
          <TerminalAiComposer
            sessionId={activeSession.id}
            variant="full"
            registerToggle={false}
            registerOpen={false}
            registerSend={false}
            onShowSessionList={focusMode ? () => setFocusMode(false) : undefined}
            onReturnToTerminal={() => onReturnToTerminal(activeSession)}
            onCloseFull={onClose}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
            <div className="composer-avatar-lg opacity-40">✦</div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-foreground">AI is disabled</h3>
              <p className="max-w-[260px] text-[11px] text-muted-foreground">
                Enable AI in Settings to use Husk AI chat, command suggestions, and inline assistance.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent("husk:open-settings"));
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-3 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/15"
            >
              <HugeiconsIcon icon={Settings01Icon} size={12} strokeWidth={1.75} />
              Open Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
