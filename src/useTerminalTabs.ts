import { useEffect, useRef, useState } from "react";
import { getActiveTerminalCwd, useActiveTerminalCwd } from "./ai/terminalContext";
import { getWorkspaceRoot } from "./workspace/store";
import {
  newLeaf,
  splitPane,
  removePane,
  setRatio,
  firstLeaf,
  type Pane,
} from "./terminalPanes";

export type TermTab = {
  id: number;
  title: string;
  root: Pane;
  focused: number;
  /** Set once the user manually renames it, so cwd auto-titling stops. */
  renamed?: boolean;
};

function makeTab(id: number, initialCwd?: string): TermTab {
  const leaf = newLeaf(initialCwd);
  return { id, title: `Terminal ${id}`, root: leaf, focused: leaf.id };
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

export type TerminalTabsApi = ReturnType<typeof useTerminalTabs>;

/**
 * Terminal-tab state lifted out of the old TerminalTabs component so the tab
 * strip can live in the top titlebar (alongside file tabs) while the panes
 * render in the body — both reading this one source of truth.
 */
export function useTerminalTabs() {
  // First terminal opens in the saved workspace (Rust validates / falls back).
  const [tabs, setTabs] = useState<TermTab[]>(() => [makeTab(1, getWorkspaceRoot() || undefined)]);
  const [activeId, setActiveId] = useState(1);
  const nextId = useRef(2);

  const updateTab = (tabId: number, fn: (t: TermTab) => TermTab) =>
    setTabs((prev) => prev.map((t) => (t.id === tabId ? fn(t) : t)));

  const addTab = () => {
    const id = nextId.current++;
    setTabs((prev) => [...prev, makeTab(id, getActiveTerminalCwd() || undefined)]);
    setActiveId(id);
    return id;
  };

  const closeTab = (id: number) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const remaining = tabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      const fresh = nextId.current++;
      setTabs([makeTab(fresh)]);
      setActiveId(fresh);
    } else {
      setTabs(remaining);
      if (activeId === id) setActiveId(remaining[Math.max(0, idx - 1)].id);
    }
  };

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

  const renameTab = (id: number, title: string) =>
    updateTab(id, (t) => ({ ...t, title: title.trim() || t.title, renamed: true }));

  // Auto-title the active tab from the active terminal's cwd (husk v1), unless
  // it was manually renamed.
  const cwd = useActiveTerminalCwd();
  useEffect(() => {
    if (!cwd) return;
    const title = basename(cwd);
    setTabs((prev) =>
      prev.map((t) => (t.id === activeId && !t.renamed && t.title !== title ? { ...t, title } : t)),
    );
  }, [cwd, activeId]);

  return {
    tabs,
    activeId,
    setActiveId,
    addTab,
    closeTab,
    splitLeaf,
    closeLeaf,
    focusLeaf,
    ratioLeaf,
    renameTab,
  };
}
