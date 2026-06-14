import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Cancel01Icon,
  ComputerTerminal02Icon,
  File01Icon,
} from "@hugeicons/core-free-icons";
import type { BubbleSessionStore } from "./bubble/sessionStore";
import type { SessionStore } from "./editor/sessionStore";

interface UnifiedSession {
  id: string;
  title: string;
  updatedAt: number;
  kind: "bubble" | "editor";
  workspace?: string;
  messageCount: number;
}

function loadAllSessions(): UnifiedSession[] {
  const results: UnifiedSession[] = [];

  // Bubble sessions
  try {
    const raw = localStorage.getItem("huskv2.ai.bubble.sessions");
    if (raw) {
      const store = JSON.parse(raw) as BubbleSessionStore;
      for (const s of store.sessions) {
        results.push({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          kind: "bubble",
          messageCount: s.messages.length,
        });
      }
    }
  } catch (e) { console.error("Failed to load AI sessions", e); }

  // Editor sessions (scan all workspace keys)
  const prefix = "huskv2.ai.sessions.";
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const workspace = key.slice(prefix.length);
      const store = JSON.parse(localStorage.getItem(key)!) as SessionStore;
      for (const s of store.sessions) {
        results.push({
          id: s.id,
          title: s.title,
          updatedAt: s.updatedAt,
          kind: "editor",
          workspace,
          messageCount: s.messages.length,
        });
      }
    }
  } catch (e) { console.error("Failed to load AI sessions", e); }

  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AiSessionsPanel({
  open,
  onClose,
  onSelectBubbleSession,
  onSelectEditorSession,
}: {
  open: boolean;
  onClose: () => void;
  onSelectBubbleSession: (id: string) => void;
  onSelectEditorSession: (id: string, workspace: string) => void;
}) {
  const [sessions, setSessions] = useState<UnifiedSession[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setSessions(loadAllSessions());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose]);

  const handleDelete = useCallback((s: UnifiedSession, e: React.MouseEvent) => {
    e.stopPropagation();
    if (s.kind === "bubble") {
      try {
        const raw = localStorage.getItem("huskv2.ai.bubble.sessions");
        if (raw) {
          const store = JSON.parse(raw) as BubbleSessionStore;
          const filtered = store.sessions.filter((x) => x.id !== s.id);
          const next: BubbleSessionStore = {
            sessions: filtered,
            activeSessionId:
              store.activeSessionId === s.id
                ? filtered[0]?.id ?? null
                : store.activeSessionId,
          };
          localStorage.setItem("huskv2.ai.bubble.sessions", JSON.stringify(next));
        }
      } catch (e) { console.error("Failed to delete bubble session", e); }
    } else {
      const prefix = "huskv2.ai.sessions.";
      try {
        const raw = localStorage.getItem(prefix + (s.workspace ?? "default"));
        if (raw) {
          const store = JSON.parse(raw) as SessionStore;
          const filtered = store.sessions.filter((x) => x.id !== s.id);
          const next: SessionStore = {
            sessions: filtered,
            activeSessionId:
              store.activeSessionId === s.id
                ? filtered[0]?.id ?? null
                : store.activeSessionId,
          };
          localStorage.setItem(prefix + (s.workspace ?? "default"), JSON.stringify(next));
        }
      } catch (e) { console.error("Failed to delete editor session", e); }
    }
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    setConfirmDeleteId(null);
  }, []);

  if (!open) return null;

  const bubbleSessions = sessions.filter((s) => s.kind === "bubble");
  const editorSessions = sessions.filter((s) => s.kind === "editor");

  return createPortal(
    <div
      ref={panelRef}
      className="absolute top-full right-0 z-50 w-80 min-w-[20rem] border border-border/60 bg-background/95 backdrop-blur-xl shadow-2xl rounded-md mt-1 overflow-hidden"
    >
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          AI Sessions
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-5 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          title="Close"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={1.75} />
        </Button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="py-6 text-center text-[11px] text-muted-foreground">
            No AI sessions yet — start a chat to see them here.
          </div>
        )}

        {bubbleSessions.length > 0 && (
          <div className="border-b border-border/30 last:border-0">
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Terminal AI
            </div>
            {bubbleSessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                onClick={() => {
                  onSelectBubbleSession(s.id);
                  onClose();
                }}
                onDelete={(e) => handleDelete(s, e)}
                isConfirming={confirmDeleteId === s.id}
                onToggleConfirm={() =>
                  setConfirmDeleteId((id) => (id === s.id ? null : s.id))
                }
              />
            ))}
          </div>
        )}

        {editorSessions.length > 0 && (
          <div className={cn(bubbleSessions.length > 0 && "border-t border-border/30")}>
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Editor AI
            </div>
            {editorSessions.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                onClick={() => {
                  onSelectEditorSession(s.id, s.workspace ?? "default");
                  onClose();
                }}
                onDelete={(e) => handleDelete(s, e)}
                isConfirming={confirmDeleteId === s.id}
                onToggleConfirm={() =>
                  setConfirmDeleteId((id) => (id === s.id ? null : s.id))
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function SessionRow({
  s,
  onClick,
  onDelete,
  isConfirming,
  onToggleConfirm,
}: {
  s: UnifiedSession;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  isConfirming: boolean;
  onToggleConfirm: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-2 py-1.5 px-3 text-[11px] hover:bg-accent/50",
        isConfirming ? "cursor-default" : "cursor-pointer",
      )}
      onClick={isConfirming ? undefined : onClick}
    >
      <HugeiconsIcon
        icon={s.kind === "bubble" ? ComputerTerminal02Icon : File01Icon}
        size={12}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground">{s.title}</div>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground/50">
        {s.messageCount} · {formatDate(s.updatedAt)}
      </span>
      {isConfirming ? (
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded p-0.5 text-destructive hover:bg-destructive/10"
          title="Confirm delete"
        >
          <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={2} />
        </button>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleConfirm();
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 group-hover:opacity-60 hover:text-foreground hover:opacity-100"
          title="Delete session"
        >
          <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
