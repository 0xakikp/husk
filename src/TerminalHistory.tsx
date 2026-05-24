import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Reverse-history picker (Ctrl+R): a filterable list of the shell's past
 * commands. Up/Down to move, Enter to drop the command at the prompt, Esc to
 * close. Replaces the shell's built-in reverse-i-search with a GUI list.
 */
export function TerminalHistoryPanel({
  entries,
  loading,
  onSelect,
  onClose,
}: {
  entries: string[];
  loading: boolean;
  onSelect: (command: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? entries.filter((c) => c.toLowerCase().includes(q)) : entries;
    return base.slice(0, 300);
  }, [entries, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, entries]);

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (i: number) => {
    const cmd = filtered[i];
    if (cmd) onSelect(cmd);
  };

  return (
    <div className="term-hist">
      <input
        autoFocus
        className="term-hist-input"
        value={query}
        placeholder={loading ? "Loading history…" : "Search history…"}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "r")) {
            e.preventDefault();
            setIndex((i) => Math.min(Math.max(filtered.length - 1, 0), i + 1));
          } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
            e.preventDefault();
            setIndex((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(index);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
      />
      <div className="term-hist-list" ref={listRef}>
        {filtered.length === 0 ? (
          <div className="term-hist-empty">{loading ? "…" : "No matching history"}</div>
        ) : (
          filtered.map((cmd, i) => (
            <button
              key={`${i}-${cmd}`}
              type="button"
              className={`term-hist-item${i === index ? " active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              {cmd}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
