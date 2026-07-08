import { useState, useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlusSignIcon, MessageMultiple02Icon, SparklesIcon, ComputerTerminal02Icon, Archive02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { cn } from "../lib/utils";
import { TerminalAiComposer } from "../terminal/TerminalAiComposer";
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

export function AiTabPanel() {
  const sessions = useSessions();
  const activeId = useActiveSessionId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ensure a global session exists for the AI tab itself
  useEffect(() => {
    ensureSession("global", { name: "AI Chat", source: "ai-tab" });
    if (!activeId) {
      setActiveSessionId("global");
    }
  }, [activeId]);

  const activeSession = activeId ? getSession(activeId) : getSession("global");
  const activeList = sessions.filter((s) => !s.archived);
  const archivedList = sessions.filter((s) => s.archived);

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

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Session sidebar */}
      <div className="flex h-full w-56 flex-col border-r border-border/60 bg-background/95">
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
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-2">
          <div className="flex flex-col gap-1">
            {activeList.map((s) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors",
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
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <HugeiconsIcon
                        icon={isTabSessionId(s.id) ? ComputerTerminal02Icon : SparklesIcon}
                        size={11}
                        strokeWidth={1.75}
                        className={cn("shrink-0", activeSession.id === s.id ? "text-primary" : "text-muted-foreground/60")}
                      />
                      <span className="truncate">{s.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(s.id, s.name)}
                      className="inline-flex size-4 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-muted hover:text-foreground"
                      title="Rename"
                    >
                      ⋮
                    </button>
                    <button
                      type="button"
                      onClick={() => archiveSession(s.id)}
                      className="inline-flex size-4 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-muted hover:text-foreground"
                      title="Archive"
                    >
                      <HugeiconsIcon icon={Archive02Icon} size={9} strokeWidth={1.75} />
                    </button>
                    {activeList.length > 1 && (
                      <button
                        type="button"
                        onClick={() => deleteSession(s.id)}
                        className="inline-flex size-4 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
                        title="Delete"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={9} strokeWidth={1.75} />
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
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
                  {archivedList.map((s) => (
                    <div
                      key={s.id}
                      className={cn(
                        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors",
                        activeSession.id === s.id
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveSessionId(s.id)}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        <HugeiconsIcon
                          icon={isTabSessionId(s.id) ? ComputerTerminal02Icon : SparklesIcon}
                          size={11}
                          strokeWidth={1.75}
                          className={cn("shrink-0", activeSession.id === s.id ? "text-primary" : "text-muted-foreground/60")}
                        />
                        <span className="truncate">{s.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => unarchiveSession(s.id)}
                        className="inline-flex size-4 items-center justify-center rounded text-muted-foreground/70 opacity-60 transition-opacity hover:opacity-100 hover:bg-muted hover:text-foreground"
                        title="Unarchive"
                      >
                        <HugeiconsIcon icon={Archive02Icon} size={9} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteSession(s.id)}
                        className="inline-flex size-4 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
                        title="Delete"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={9} strokeWidth={1.75} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TerminalAiComposer sessionId={activeSession.id} variant="full" registerToggle={false} registerOpen={false} registerSend={false} />
      </div>
    </div>
  );
}
