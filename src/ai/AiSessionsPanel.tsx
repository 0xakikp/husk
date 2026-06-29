import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Cancel01Icon,
  MessageMultiple02Icon,
} from "@hugeicons/core-free-icons";
import type { BubbleSessionStore } from "./bubble/sessionStore";
import { fontStack } from "../styles/fonts";
import { getPrefs } from "../settings/preferences";

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
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  const prefs = getPrefs();
  const fontFamily = fontStack(prefs.fontFamily);

  useEffect(() => {
    if (open) setSessions(loadBubbleSessions());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    } else {
      setPosition({ top: 40, right: 16 });
    }
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open || !position) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef?.current && anchorRef.current.contains(target)) return;
      if (panelRef.current && !panelRef.current.contains(target)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose, position, anchorRef]);

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
        setConfirmDeleteId(null);
      }
    } catch (e) {
      console.error("Failed to delete session", e);
    }
  }, []);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="husk-popover"
      style={{ fontFamily, top: position.top, right: position.right }}
    >
      <div className="husk-popover-header">
        <span className="husk-popover-title">
          <HugeiconsIcon icon={MessageMultiple02Icon} size={13} strokeWidth={1.75} style={{ marginRight: 5 }} />
          Sessions
        </span>
        <button
          type="button"
          onClick={onClose}
          className="husk-popover-close"
          aria-label="Close"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      </div>

      <div className="husk-popover-list">
        {sessions.length === 0 ? (
          <div className="husk-popover-empty">No sessions yet</div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => {
                onSelectSession(s.id);
                onClose();
              }}
              className="husk-popover-item"
            >
              <span className="husk-popover-text">{s.title}</span>
              <span className="husk-popover-meta">
                {s.messageCount} msgs · {formatDate(s.updatedAt)}
              </span>
              {confirmDeleteId === s.id ? (
                <span className="husk-popover-delete-confirm">
                  <button type="button" onClick={(e) => handleDelete(s, e)}>Delete</button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>Cancel</button>
                </span>
              ) : (
                <span
                  className="husk-popover-delete"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                  title="Delete session"
                  role="button"
                  aria-label="Delete session"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
                </span>
              )}
            </button>
          ))
        )}
      </div>

      <div className="husk-popover-footer">
        <span>{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
      </div>
    </div>,
    document.body
  );
}
