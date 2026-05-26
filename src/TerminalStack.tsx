import { PaneView, leafCount } from "./terminalPanes";
import type { TerminalTabsApi } from "./useTerminalTabs";

/**
 * Body half of the terminal tabs: every tab stays mounted (just hidden) so its
 * PTYs and scrollback survive switching tabs — and survive switching to a file
 * tab too, when `viewActive` is false and the parent display:none's the strip.
 */
export function TerminalStack({
  term,
  viewActive,
}: {
  term: TerminalTabsApi;
  viewActive: boolean;
}) {
  const { tabs, activeId, splitLeaf, closeLeaf, focusLeaf, ratioLeaf } = term;
  return (
    <div className="terminal-stack">
      {tabs.map((t) => (
        <div
          key={t.id}
          className="terminal-pane"
          style={{ display: t.id === activeId ? "block" : "none" }}
        >
          <PaneView
            node={t.root}
            tabActive={viewActive && t.id === activeId}
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
  );
}
