import { useState, useEffect, useRef, useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, MessageMultiple02Icon, SparklesIcon, ComputerTerminal02Icon, Archive02Icon, Delete02Icon, Search01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { TerminalAiComposer } from "../terminal/TerminalAiComposer";
import { usePrefs } from "../settings/preferences";
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
} from "./sessionStore";

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

export function AiTabPanel() {
  const sessions = useSessions();
  const activeId = useActiveSessionId();
  const prefs = usePrefs();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
    return sessions.filter((s) => fuzzyMatch(q, s.name));
  }, [sessions, query]);

  const activeList = filtered.filter((s) => !s.archived);
  const archivedList = filtered.filter((s) => s.archived);

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

  const sessionRow = (s: typeof sessions[0], isArchived = false) => (
    <div
      key={s.id}
      className={cn(
        "group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] transition-colors",
        activeSession.id === s.id
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
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
            <span className="flex w-full items-center gap-2">
              <HugeiconsIcon
                icon={isTabSessionId(s.id) ? ComputerTerminal02Icon : SparklesIcon}
                size={11}
                strokeWidth={1.75}
                className={cn("shrink-0", activeSession.id === s.id ? "text-primary" : "text-muted-foreground/60")}
              />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="ml-[17px] text-[9px] text-muted-foreground/50">
              {s.messages.length} msg{s.messages.length === 1 ? "" : "s"} · {formatDate(s.updatedAt)}
            </span>
          </button>
          <button
            type="button"
            onClick={() => startRename(s.id, s.name)}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-muted hover:text-foreground"
            title="Rename"
          >
            ⋮
          </button>
          {isArchived ? (
            <button
              type="button"
              onClick={() => unarchiveSession(s.id)}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-muted hover:text-foreground"
              title="Unarchive"
            >
              <HugeiconsIcon icon={Archive02Icon} size={9} strokeWidth={1.75} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => archiveSession(s.id)}
              className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-muted hover:text-foreground"
              title="Archive"
            >
              <HugeiconsIcon icon={Archive02Icon} size={9} strokeWidth={1.75} />
            </button>
          )}
          <button
            type="button"
            onClick={() => deleteSession(s.id)}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
            title="Delete"
          >
            <HugeiconsIcon icon={Delete02Icon} size={9} strokeWidth={1.75} />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Session sidebar */}
      <div className="flex h-full w-56 shrink-0 flex-col border-r border-border/60 bg-background/95">
        <div className="flex h-8 shrink-0 items-center justify-between border-b border-border/60 px-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            <HugeiconsIcon icon={MessageMultiple02Icon} size={13} strokeWidth={1.75} />
            AI Chats
          </span>
          <button
            type="button"
            onClick={() => {
              const s = createSession({ source: "ai-tab" });
              setActiveSessionId(s.id);
            }}
            className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title="New chat"
          >
            <HugeiconsIcon icon={PlusSignIcon} size={12} strokeWidth={1.75} />
          </button>
        </div>
        <div className="px-2 pt-2">
          <div className="relative">
            <HugeiconsIcon icon={Search01Icon} size={11} strokeWidth={1.75} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions..."
              className="h-7 w-full box-border rounded-md border border-border/60 bg-muted/30 pl-7 pr-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/60 focus:bg-muted/50"
            />
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-1">
            {activeList.map((s) => sessionRow(s))}
          </div>

          {archivedList.length > 0 && (
            <div className="mt-2 pt-2 border-t border-border/40">
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="flex w-full items-center justify-between px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
              >
                <span>Archived ({archivedList.length})</span>
                <span>{showArchived ? "▾" : "▸"}</span>
              </button>
              {showArchived && (
                <div className="flex flex-col gap-1 mt-1">
                  {archivedList.map((s) => sessionRow(s, true))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {prefs.aiEnabled ? (
          <TerminalAiComposer sessionId={activeSession.id} variant="full" registerToggle={false} registerOpen={false} registerSend={false} />
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
                // Broadcast open settings from the AI tab. The App layer listens for this event.
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
