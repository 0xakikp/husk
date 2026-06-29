import { useEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import { ClipboardIcon, Delete02Icon } from "@hugeicons/core-free-icons";
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

export function ClipboardPanel({ onClose }: { onClose: () => void }) {
  const history = useClipHistory();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const prefs = getPrefs();
  const fontFamily = fontStack(prefs.fontFamily);
  const fontSize = prefs.terminalFontSize;

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
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

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

  return (
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
        className="term-hist"
        ref={panelRef}
        style={{ fontFamily, fontSize: `${fontSize}px` }}
      >
        <div className="term-hist-header">
          <span className="term-hist-title">
            <HugeiconsIcon icon={ClipboardIcon} size={14} strokeWidth={1.75} style={{ marginRight: 6 }} />
            Clipboard history
          </span>
          <span className="term-hist-hint">Ctrl+Shift+V</span>
        </div>
        <input
          ref={inputRef}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="term-hist-input"
          value={query}
          placeholder="Search clipboard…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="term-hist-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="term-hist-empty">
              {query.trim() ? "No matching clipboard items" : "Clipboard is empty. Copy something to get started."}
            </div>
          ) : (
            filtered.map((it, i) => (
              <button
                key={it.id}
                type="button"
                className={`term-hist-item${i === index ? " active" : ""}${!query.trim() && i % 2 === 1 ? " alt" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
                title={it.text}
              >
                <span className="term-hist-command">{it.text}</span>
                <span className="term-hist-match-badge" style={{ color: "#444" }}>
                  {formatTime(it.createdAt)}
                </span>
                <span
                  className="term-hist-delete"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => remove(e, it.id)}
                  title="Delete"
                  role="button"
                  aria-label="Delete clipboard item"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={1.75} />
                </span>
              </button>
            ))
          )}
        </div>
        <div className="term-hist-footer">
          <span>
            {filtered.length > 0
              ? `${filtered.length} item${filtered.length === 1 ? "" : "s"}`
              : query.trim()
                ? "0 results"
                : ""}
          </span>
          <span className="flex items-center gap-3">
            {history.length > 0 && (
              <button
                type="button"
                onClick={clearClips}
                className="term-hist-footer-action"
                title="Clear all"
              >
                Clear all
              </button>
            )}
            {filtered.length > 0 && index >= 0 && (
              <span>{`${index + 1} / ${filtered.length}`}</span>
            )}
          </span>
        </div>
      </div>
    </>
  );
}
