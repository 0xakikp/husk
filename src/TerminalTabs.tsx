import { useRef, useState } from "react";
import { TerminalView } from "./Terminal";

type Tab = { id: number; title: string };

/**
 * Tabbed terminals. Every tab stays mounted (just hidden when inactive) so its
 * PTY session and scrollback survive switching; closing a tab unmounts it,
 * which tears the PTY down via TerminalView's cleanup.
 */
export function TerminalTabs() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: 1, title: "Terminal 1" }]);
  const [activeId, setActiveId] = useState(1);
  const nextId = useRef(2);

  const addTab = () => {
    const id = nextId.current++;
    setTabs((prev) => [...prev, { id, title: `Terminal ${id}` }]);
    setActiveId(id);
  };

  const closeTab = (id: number) => {
    const idx = tabs.findIndex((t) => t.id === id);
    let next = tabs.filter((t) => t.id !== id);
    let nextActive = activeId;

    if (next.length === 0) {
      // Never leave zero terminals — replace with a fresh one.
      const fresh = nextId.current++;
      next = [{ id: fresh, title: `Terminal ${fresh}` }];
      nextActive = fresh;
    } else if (activeId === id) {
      nextActive = next[Math.max(0, idx - 1)].id;
    }

    setTabs(next);
    setActiveId(nextActive);
  };

  return (
    <div className="terminals">
      <div className="tabbar" role="tablist">
        {tabs.map((t) => (
          <div key={t.id} className={`tab${t.id === activeId ? " active" : ""}`}>
            <button
              type="button"
              role="tab"
              aria-selected={t.id === activeId}
              className="tab-label"
              onClick={() => setActiveId(t.id)}
            >
              {t.title}
            </button>
            <button
              type="button"
              className="tab-close"
              title="Close terminal"
              aria-label={`Close ${t.title}`}
              onClick={() => closeTab(t.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button type="button" className="tab-add" title="New terminal" onClick={addTab}>
          +
        </button>
      </div>

      <div className="terminal-stack">
        {tabs.map((t) => (
          <div
            key={t.id}
            className="terminal-pane"
            style={{ display: t.id === activeId ? "block" : "none" }}
          >
            <TerminalView active={t.id === activeId} />
          </div>
        ))}
      </div>
    </div>
  );
}
