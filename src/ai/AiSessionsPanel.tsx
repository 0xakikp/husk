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
}: {
  open: boolean;
  onClose: () => void;
  onSelectSession: (id: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const prefs = getPrefs();
  const fontFamily = fontStack(prefs.fontFamily);
  const fontSize = prefs.terminalFontSize;

  useEffect(() => {
    if (open) setSessions(loadBubbleSessions());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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

  if (!open) return null;

  return createPortal(
    <>
      <div
        className="term-hist-backdrop"
        onClick={onClose}
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={panelRef}
        className="term-hist"
        style={{ fontFamily, fontSize: `${fontSize}px` }}
      >
        <div className="term-hist-header">
          <span className="term-hist-title">
            <HugeiconsIcon icon={MessageMultiple02Icon} size={14} strokeWidth={1.75} style={{ marginRight: 6 }} />
            Sessions
          </span>
          <button
            type="button"
            onClick={onClose}
            className="term-hist-close"
            aria-label="Close"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
          </button>
        </div>

        <div className="term-hist-list">
          {sessions.length === 0 ? (
            <div className="term-hist-empty">No sessions yet</div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  onSelectSession(s.id);
                  onClose();
                }}
                className="term-hist-item"
              >
                <span className="term-hist-command">{s.title}</span>
                <span className="term-hist-match-badge" style={{ color: "#444" }}>
                  {s.messageCount} msgs · {formatDate(s.updatedAt)}
                </span>
                {confirmDeleteId === s.id ? (
                  <span className="term-hist-delete-confirm">
                    <button type="button" onClick={(e) => handleDelete(s, e)}>Delete</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}>Cancel</button>
                  </span>
                ) : (
                  <span
                    className="term-hist-delete"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(s.id); }}
                    title="Delete session"
                    role="button"
                    aria-label="Delete session"
                  >
                    <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                  </span>
                )}
              </button>
            ))
          )}
        </div>

        <div className="term-hist-footer">
          <span>{sessions.length} session{sessions.length === 1 ? "" : "s"}</span>
        </div>
      </div>
    </>,
    document.body
  );
}
