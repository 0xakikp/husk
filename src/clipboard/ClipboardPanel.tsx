import { useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardIcon, Delete02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useClipHistory, deleteClip, clearClips } from "./store";
import { toast } from "../toast";
import { fontStack } from "../styles/fonts";
import { getPrefs } from "../settings/preferences";

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return "Yesterday";
  }
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

export function ClipboardPanel({ onClose, anchorRef }: { onClose: () => void; anchorRef?: React.RefObject<HTMLElement | null> }) {
  const history = useClipHistory();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);

  const prefs = getPrefs();
  const fontFamily = fontStack(prefs.fontFamily);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return history;
    return history.filter((it) => fuzzyMatch(q, it.text));
  }, [history, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, history]);

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (anchorRef?.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPosition({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    } else {
      setPosition({ top: 40, right: 16 });
    }
  }, [anchorRef]);

  useEffect(() => {
    if (!position) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
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
  }, [onClose, position, anchorRef]);

  const copy = (text: string) => {
    void writeText(text);
    toast({ title: "Copied to clipboard", variant: "info" });
    onClose();
  };

  const choose = (i: number) => {
    const text = filtered[i]?.text;
    if (text) copy(text);
  };

  const remove = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteClip(id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(Math.max(filtered.length - 1, 0), i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(index);
    }
  };

  if (!position) return null;

  return (
    <div
      ref={panelRef}
      className="husk-popover"
      style={{ fontFamily, top: position.top, right: position.right }}
    >
      <div className="husk-popover-header">
        <span className="husk-popover-title">
          <HugeiconsIcon icon={ClipboardIcon} size={13} strokeWidth={1.75} style={{ marginRight: 5 }} />
          Clipboard history
        </span>
        <button type="button" onClick={onClose} className="husk-popover-close" aria-label="Close">
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      </div>
      <input
        ref={inputRef}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className="husk-popover-input"
        value={query}
        placeholder="Search clipboard…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="husk-popover-list" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="husk-popover-empty">
            {query.trim() ? "No matching items" : "Clipboard is empty"}
          </div>
        ) : (
          filtered.map((it, i) => (
            <button
              key={it.id}
              type="button"
              className={`husk-popover-item${i === index ? " active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
              title={it.text}
            >
              <span className="husk-popover-text">{it.text.length > 120 ? `${it.text.slice(0, 120)}…` : it.text}</span>
              <span className="husk-popover-meta">{formatTime(it.createdAt)}</span>
              <span
                className="husk-popover-delete"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => remove(e, it.id)}
                title="Delete"
                role="button"
                aria-label="Delete clipboard item"
              >
                <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={1.75} />
              </span>
            </button>
          ))
        )}
      </div>
      <div className="husk-popover-footer">
        <span>{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
        {history.length > 0 && (
          <button type="button" onClick={clearClips} className="husk-popover-footer-action" title="Clear all">
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
