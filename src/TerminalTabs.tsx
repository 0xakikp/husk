import { useRef, useState } from "react";
import { getActiveTerminalCwd } from "./ai/terminalContext";
import {
  PaneView,
  newLeaf,
  splitPane,
  removePane,
  setRatio,
  firstLeaf,
  leafCount,
  type Pane,
} from "./terminalPanes";

type Tab = { id: number; title: string; root: Pane; focused: number };

function makeTab(id: number, initialCwd?: string): Tab {
  const leaf = newLeaf(initialCwd);
  return { id, title: `Terminal ${id}`, root: leaf, focused: leaf.id };
}

/**
 * Tabbed terminals, each holding a tree of split panes. Tabs stay mounted (just
 * hidden) so their PTYs and scrollback survive switching. Cmd+D / Cmd+Shift+D
 * (or the right-click menu) split the focused pane.
 */
export function TerminalTabs() {
  const [tabs, setTabs] = useState<Tab[]>([makeTab(1)]);
  const [activeId, setActiveId] = useState(1);
  const nextId = useRef(2);

  const addTab = () => {
    const id = nextId.current++;
    setTabs((prev) => [...prev, makeTab(id, getActiveTerminalCwd() || undefined)]);
    setActiveId(id);
  };

  const closeTab = (id: number) => {
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      let next = prev.filter((t) => t.id !== id);
      if (next.length === 0) {
        const fresh = nextId.current++;
        next = [makeTab(fresh)];
        setActiveId(fresh);
      } else if (activeId === id) {
        setActiveId(next[Math.max(0, idx - 1)].id);
      }
      return next;
    });
  };

  const updateTab = (tabId: number, fn: (t: Tab) => Tab) =>
    setTabs((prev) => prev.map((t) => (t.id === tabId ? fn(t) : t)));

  const splitLeaf = (tabId: number, leafId: number, dir: "row" | "col") =>
    updateTab(tabId, (t) => {
      const leaf = newLeaf(getActiveTerminalCwd() || undefined);
      return { ...t, root: splitPane(t.root, leafId, dir, () => leaf), focused: leaf.id };
    });

  const closeLeaf = (tabId: number, leafId: number) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const root = removePane(tab.root, leafId);
    if (root === null) {
      closeTab(tabId); // last pane in the tab — close the tab
      return;
    }
    updateTab(tabId, (t) => ({
      ...t,
      root,
      focused: t.focused === leafId ? firstLeaf(root) : t.focused,
    }));
  };

  const focusLeaf = (tabId: number, leafId: number) =>
    updateTab(tabId, (t) => (t.focused === leafId ? t : { ...t, focused: leafId }));

  const ratioLeaf = (tabId: number, splitId: number, ratio: number) =>
    updateTab(tabId, (t) => ({ ...t, root: setRatio(t.root, splitId, ratio) }));

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
            <PaneView
              node={t.root}
              tabActive={t.id === activeId}
              focusedId={t.focused}
              multi={leafCount(t.root) > 1}
              onSplit={(leafId, dir) => splitLeaf(t.id, leafId, dir)}
              onClose={(leafId) => closeLeaf(t.id, leafId)}
              onFocus={(leafId) => focusLeaf(t.id, leafId)}
              onRatio={(splitId, ratio) => ratioLeaf(t.id, splitId, ratio)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
