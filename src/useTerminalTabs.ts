import { useEffect, useRef, useState, useCallback } from "react";
import { getActiveTerminalCwd, useActiveTerminalCwd } from "./ai/terminalContext";
import { getWorkspaceRoot } from "./workspace/store";
import { getPrefs } from "./settings/preferences";
import { homeDir } from "./fs";
import { renameSession, tabSessionId } from "./ai/sessionStore";
import {
  newLeaf,
  splitPane,
  removePane,
  setRatio,
  setLeafCheckpoint,
  setLeafCwd,
  hydratePane,
  firstLeaf,
  type Pane,
} from "./terminalPanes";
import { disposeSession } from "./terminal/registry";
import { leafIds } from "./terminal/paneUtils";

export type TermTab = {
  id: number;
  title: string;
  root: Pane;
  focused: number;
  /** Set once the user manually renames it, so cwd auto-titling stops. */
  renamed?: boolean;
  /** User-assigned color for visual grouping. */
  color?: string;
  /** Per-tab SFTP state */
  sftpHost?: string;
  sftpOpen?: boolean;
  /** Pinned tabs stay at the left and can't be closed without unpinning. */
  pinned?: boolean;
};

function makeTab(id: number, initialCwd?: string): TermTab {
  const leaf = newLeaf(initialCwd);
  return { id, title: `Terminal ${id}`, root: leaf, focused: leaf.id };
}

function basename(p: string): string {
  const parts = p.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}

/* ── Session persistence ─────────────────────────────────────────── */

const SESSION_KEY = "huskv2.session.v1";

type SavedTab = {
  /** v1 fallback: first pane's initial directory. */
  cwd?: string;
  /** v2: full pane arrangement, current pane directories, and checkpoints. */
  root?: unknown;
  focused?: number;
  title?: string;
  renamed?: boolean;
  color?: string;
  sftpHost?: string;
  sftpOpen?: boolean;
  pinned?: boolean;
};
type SavedSession = { tabs: SavedTab[]; activeIndex: number };

function saveSession(tabs: TermTab[], activeId: number) {
  const saved: SavedTab[] = [];
  for (const t of tabs) {
    saved.push({
      root: t.root,
      focused: t.focused,
      title: t.renamed ? t.title : undefined,
      renamed: t.renamed,
      color: t.color,
      sftpHost: t.sftpHost,
      sftpOpen: t.sftpOpen,
      pinned: t.pinned,
    });
  }
  const activeIndex = tabs.findIndex((t) => t.id === activeId);
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ tabs: saved, activeIndex }));
  } catch { /* storage full or unavailable */ }
}

function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const session = parsed as { tabs?: unknown; activeIndex?: unknown };
      if (!Array.isArray(session.tabs)) return null;
      return {
        tabs: session.tabs.filter((tab): tab is SavedTab => Boolean(tab) && typeof tab === "object"),
        activeIndex: typeof session.activeIndex === "number" && Number.isFinite(session.activeIndex)
          ? Math.trunc(session.activeIndex)
          : 0,
      };
    }
  } catch { /* corrupt or unavailable */ }
  return null;
}

function isSafeCheckpointCommand(command: string): boolean {
  /* A restart marker is convenience UI, not a terminal-history vault. Avoid
     persisting commands that look like credentials or bearer material. */
  return !/\b(?:token|password|passwd|secret|authorization|bearer|api[_-]?key)\b|\b(?:gh[pousr]_|github_pat_|sk-|AKIA)[\w-]+/i.test(command);
}

export type TerminalTabsApi = ReturnType<typeof useTerminalTabs>;

/**
 * Terminal-tab state lifted out of the old TerminalTabs component so the tab
 * strip can live in the top titlebar (alongside file tabs) while the panes
 * render in the body — both reading this one source of truth.
 */
export function useTerminalTabs() {
  const [tabs, setTabs] = useState<TermTab[]>([]);
  const [activeId, setActiveId] = useState(1);
  const [home, setHome] = useState<string>("");
  const nextId = useRef(2);
  const restoredRef = useRef(false);

  // Refs so callback helpers always see fresh state.
  const tabsRef = useRef(tabs);
  const activeIdRef = useRef(activeId);
  useEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);

  // Fetch home directory once on mount so we can use it for explicit CWD.
  useEffect(() => {
    void homeDir().then(setHome).catch(() => setHome(""));
  }, []);

  // Initialise tabs once home is known (or immediately if already cached).
  useEffect(() => {
    if (restoredRef.current) return;
    const prefs = getPrefs();
    if (prefs.sessionRestoreEnabled) {
      const saved = loadSession();
      if (saved && saved.tabs.length > 0) {
        const out: TermTab[] = [];
        /* Pane IDs identify live xterm registry sessions, so they must be
           unique across every restored tab, not merely inside one split tree. */
        const restoredPaneIds = new Set<number>();
        let id = 1;
        for (const t of saved.tabs) {
          const restoredRoot = hydratePane(t.root, restoredPaneIds);
          const fallback = makeTab(id, t.cwd || home || undefined);
          const root = restoredRoot ?? fallback.root;
          const leaves = leafIds(root);
          out.push({
            ...fallback,
            root,
            focused: typeof t.focused === "number" && leaves.includes(t.focused) ? t.focused : firstLeaf(root),
          });
          if (t.renamed && t.title) {
            out[out.length - 1].title = t.title;
            out[out.length - 1].renamed = true;
          }
          if (t.color) {
            out[out.length - 1].color = t.color;
          }
          if (t.sftpHost) {
            out[out.length - 1].sftpHost = t.sftpHost;
            out[out.length - 1].sftpOpen = t.sftpOpen ?? false;
          }
          if (t.pinned) {
            out[out.length - 1].pinned = true;
          }
          id++;
        }
        nextId.current = id;
        setTabs(out);
        setActiveId(out[Math.max(0, Math.min(saved.activeIndex, out.length - 1))].id);
        restoredRef.current = true;
        return;
      }
    }
    // Fresh start — workspace root, then home, then let Rust decide.
    const initialCwd = getWorkspaceRoot() || home || undefined;
    setTabs([makeTab(1, initialCwd)]);
    setActiveId(1);
    nextId.current = 2;
    restoredRef.current = true;
  }, [home]);

  // Auto-save whenever tabs or active tab change.
  useEffect(() => {
    if (!restoredRef.current) return;
    saveSession(tabs, activeId);
  }, [tabs, activeId]);

  const updateTab = (tabId: number, fn: (t: TermTab) => TermTab) =>
    setTabs((prev) => prev.map((t) => (t.id === tabId ? fn(t) : t)));

  const addTab = (initialCwd?: string) => {
    const id = nextId.current++;
    setTabs((prev) => [...prev, makeTab(id, initialCwd || getActiveTerminalCwd() || home || undefined)]);
    setActiveId(id);
    return id;
  };

  const closeTab = useCallback((id: number) => {
    const currentTabs = tabsRef.current;
    const currentActive = activeIdRef.current;
    const idx = currentTabs.findIndex((t) => t.id === id);
    const tab = currentTabs[idx];
    // Dispose all terminals in this tab
    if (tab) {
      for (const leafId of leafIds(tab.root)) {
        disposeSession(leafId);
      }
    }
    const remaining = currentTabs.filter((t) => t.id !== id);
    if (remaining.length === 0) {
      const fresh = nextId.current++;
      setTabs([makeTab(fresh, home || undefined)]);
      setActiveId(fresh);
    } else {
      setTabs(remaining);
      if (currentActive === id) {
        setActiveId(remaining[Math.max(0, idx - 1)].id);
      }
    }
  }, [home]);

  const splitLeaf = (tabId: number, leafId: number, dir: "row" | "col") =>
    updateTab(tabId, (t) => {
      const leaf = newLeaf(getActiveTerminalCwd() || home || undefined);
      return { ...t, root: splitPane(t.root, leafId, dir, () => leaf), focused: leaf.id };
    });

  const closeLeaf = useCallback((tabId: number, leafId: number) => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    const root = removePane(tab.root, leafId);
    // Dispose the closed leaf's terminal
    disposeSession(leafId);
    if (root === null) {
      // last pane in the tab — close the tab
      const idx = tabsRef.current.findIndex((t) => t.id === tabId);
      const remaining = tabsRef.current.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        const fresh = nextId.current++;
        setTabs([makeTab(fresh, home || undefined)]);
        setActiveId(fresh);
      } else {
        setTabs(remaining);
        if (activeIdRef.current === tabId) {
          setActiveId(remaining[Math.max(0, idx - 1)].id);
        }
      }
      return;
    }
    updateTab(tabId, (t) => ({
      ...t,
      root,
      focused: t.focused === leafId ? firstLeaf(root) : t.focused,
    }));
  }, [home]);

  const focusLeaf = (tabId: number, leafId: number) =>
    updateTab(tabId, (t) => (t.focused === leafId ? t : { ...t, focused: leafId }));

  /** Find the geometric sibling of a leaf in the pane tree.
   *  dir: which direction to look — 'left' means the leaf that is
   *  visually to the left (i.e. in the same row split, the 'a' sibling).
   */
  const findSiblingLeaf = (node: Pane, leafId: number, dir: "left" | "right" | "up" | "down"): number | null => {
    if (node.kind === "leaf") return null;
    // Check if leafId is in left/top child
    const inA = containsLeaf(node.a, leafId);
    const inB = containsLeaf(node.b, leafId);
    if (!inA && !inB) return null;

    // If we're looking for a sibling in the same split
    if (node.dir === "row" && (dir === "left" || dir === "right")) {
      if (inA && dir === "right") return firstLeaf(node.b);
      if (inB && dir === "left") return firstLeaf(node.a);
    }
    if (node.dir === "col" && (dir === "up" || dir === "down")) {
      if (inA && dir === "down") return firstLeaf(node.b);
      if (inB && dir === "up") return firstLeaf(node.a);
    }

    // Recurse into the child that contains leafId
    const child = inA ? node.a : node.b;
    const sibling = findSiblingLeaf(child, leafId, dir);
    if (sibling) return sibling;

    // If no sibling found deeper, and we're at the top level where
    // the split direction matches, return the other branch's first leaf
    if (node.dir === "row" && (dir === "left" || dir === "right")) {
      if (inA && dir === "right") return firstLeaf(node.b);
      if (inB && dir === "left") return firstLeaf(node.a);
    }
    if (node.dir === "col" && (dir === "up" || dir === "down")) {
      if (inA && dir === "down") return firstLeaf(node.b);
      if (inB && dir === "up") return firstLeaf(node.a);
    }
    return null;
  };

  function containsLeaf(node: Pane, leafId: number): boolean {
    if (node.kind === "leaf") return node.id === leafId;
    return containsLeaf(node.a, leafId) || containsLeaf(node.b, leafId);
  }

  const focusLeafDirection = (tabId: number, dir: "left" | "right" | "up" | "down") => {
    const tab = tabsRef.current.find((t) => t.id === tabId);
    if (!tab) return;
    const sibling = findSiblingLeaf(tab.root, tab.focused, dir);
    if (sibling) {
      updateTab(tabId, (t) => ({ ...t, focused: sibling }));
    }
  };

  const ratioLeaf = (tabId: number, splitId: number, ratio: number) =>
    updateTab(tabId, (t) => ({ ...t, root: setRatio(t.root, splitId, ratio) }));

  const updateLeafCwd = (tabId: number, leafId: number, cwd: string) =>
    updateTab(tabId, (t) => ({ ...t, root: setLeafCwd(t.root, leafId, cwd) }));

  const updateLeafCheckpoint = (
    tabId: number,
    leafId: number,
    checkpoint: { cwd?: string; command?: string; exitCode?: number | null; at?: number },
  ) =>
    updateTab(tabId, (t) => {
      const safe = checkpoint.command && !isSafeCheckpointCommand(checkpoint.command)
        ? { ...checkpoint, command: undefined }
        : checkpoint;
      return { ...t, root: setLeafCheckpoint(t.root, leafId, safe) };
    });

  const renameTab = (id: number, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    updateTab(id, (t) => ({ ...t, title: trimmed, renamed: true }));
    renameSession(tabSessionId(id), trimmed);
  };

  const setTabColor = (id: number, color: string | undefined) =>
    updateTab(id, (t) => ({ ...t, color }));

  const moveTab = (fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [removed] = next.splice(fromIndex, 1);
      // Prevent moving a pinned tab after an unpinned tab
      const pinnedCount = next.filter((t) => t.pinned).length;
      if (removed.pinned && toIndex > pinnedCount) {
        next.splice(pinnedCount, 0, removed);
      } else if (!removed.pinned && toIndex < pinnedCount) {
        next.splice(pinnedCount, 0, removed);
      } else {
        next.splice(toIndex, 0, removed);
      }
      return next;
    });
  };

  const pinTab = (id: number) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === id);
      if (!tab || tab.pinned) return prev;
      const next = prev.filter((t) => t.id !== id);
      // Insert pinned tab at the beginning of pinned section
      const pinnedCount = next.filter((t) => t.pinned).length;
      next.splice(pinnedCount, 0, { ...tab, pinned: true });
      return next;
    });
  };

  const unpinTab = (id: number) => {
    setTabs((prev) => {
      const tab = prev.find((t) => t.id === id);
      if (!tab || !tab.pinned) return prev;
      const next = prev.filter((t) => t.id !== id);
      // Insert unpinned tab after all pinned tabs
      const pinnedCount = next.filter((t) => t.pinned).length;
      next.splice(pinnedCount, 0, { ...tab, pinned: false });
      return next;
    });
  };

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
    focusLeafDirection,
    ratioLeaf,
    updateLeafCwd,
    updateLeafCheckpoint,
    renameTab,
    setTabColor,
    updateTab,
    moveTab,
    pinTab,
    unpinTab,
  };
}
