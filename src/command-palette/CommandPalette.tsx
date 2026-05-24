import { useEffect, useMemo, useState } from "react";

export type Command = { id: string; label: string; hint?: string; run: () => void };

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return query ? commands.filter((c) => c.label.toLowerCase().includes(query)) : commands;
  }, [q, commands]);

  useEffect(() => setSel(0), [q]);

  const choose = (c?: Command) => {
    if (c) {
      c.run();
      onClose();
    }
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          className="palette-input"
          placeholder="Type a command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              choose(filtered[sel]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 ? (
            <div className="palette-empty">No matching commands</div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`palette-item${i === sel ? " active" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => choose(c)}
              >
                <span>{c.label}</span>
                {c.hint ? <span className="palette-hint">{c.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
