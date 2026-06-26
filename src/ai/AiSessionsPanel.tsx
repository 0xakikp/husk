import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Cancel01Icon,
  ComputerTerminal02Icon,
} from "@hugeicons/core-free-icons";
import type { BubbleSessionStore } from "./bubble/sessionStore";

interface Session {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
}

function loadBubbleSessions(): Session[] {
  try {
    const raw = localStorage.getItem("huskv2.ai.bubble.sessions");
    if (!raw) return [];
    const store = JSON.parse(raw) as BubbleSessionStore;
    return store.sessions
      .map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    console.error("Failed to load AI sessions", e);
    return [];
  }
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
  onSelectSession,
  anchorRef,
}: {
  open: boolean;
  onClose: () => void;
  onSelectSession: (id: string) => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (open) setSessions(loadBubbleSessions());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Position panel relative to the anchor button (left-aligned, below the button)
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 4, left: rect.left });
    } else {
      // Fallback: left side of viewport if no anchor
      setPosition({ top: 40, left: 16 });
    }
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // Don't close if clicking the anchor button (let the button toggle handle it)
      if (anchorRef?.current && anchorRef.current.contains(target)) return;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onClose, anchorRef]);

  const handleDelete = useCallback((s: Session, e: React.MouseEvent) => {
    e.stopPropagation();
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
        setSessions(loadBubbleSessions());
      }
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  }, []);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      className={cn(
        "fixed z-50 flex flex-col gap-1 rounded-lg border border-border/60 bg-popover p-2 shadow-xl",
        "w-72 max-h-80 overflow-hidden"
      )}
      style={{ top: position.top, left: position.left }}
    >
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sessions
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5 overflow-y-auto">
        {sessions.length === 0 && (
          <div className="px-2 py-3 text-[11px] text-muted-foreground">
            No sessions yet
          </div>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              onSelectSession(s.id);
              onClose();
            }}
            className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
          >
            <HugeiconsIcon
              icon={ComputerTerminal02Icon}
              size={12}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground"
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[11px] text-foreground">{s.title}</span>
              <span className="text-[10px] text-muted-foreground">
                {s.messageCount} msgs · {formatDate(s.updatedAt)}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 opacity-0 group-hover:opacity-100">
              {confirmDeleteId === s.id ? (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-5 text-[10px] text-red-500"
                    onClick={(e) => handleDelete(s, e)}
                  >
                    Confirm
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-5 text-[10px]"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-5 w-5 p-0 text-muted-foreground hover:text-red-500"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(s.id);
                  }}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.5} />
                </Button>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}
