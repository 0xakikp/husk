import { useEffect, useState } from "react";
import { useWorkspaceRoot } from "../workspace/store";
import { currentBranch, isRepo } from "../git/client";
import { useActiveTerminalCwd, useActiveTerminalExit } from "../ai/terminalContext";

export function StatusBar({ onExplainError }: { onExplainError?: () => void }) {
  const root = useWorkspaceRoot();
  const cwd = useActiveTerminalCwd();
  const exit = useActiveTerminalExit();
  const [branch, setBranch] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (await isRepo()) {
        const b = await currentBranch();
        if (alive) setBranch(b);
      } else if (alive) {
        setBranch("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [root]);

  const name = root ? root.split("/").filter(Boolean).pop() || root : "~";
  // Live shell cwd from OSC 7 — show the last couple of path segments, full
  // path on hover.
  const prettyCwd = (() => {
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length === 0) return cwd ? "/" : "";
    return (parts.length > 2 ? "…/" : "/") + parts.slice(-2).join("/");
  })();

  return (
    <div className="statusbar">
      <span className="sb-item">📁 {name}</span>
      {branch ? <span className="sb-item">⎇ {branch}</span> : null}
      {prettyCwd ? (
        <span className="sb-item" title={cwd}>
          ❯ {prettyCwd}
        </span>
      ) : null}
      {exit != null && exit !== 0 ? (
        <button
          type="button"
          className="sb-item sb-fail"
          title="Explain this error (AI)"
          onClick={() => onExplainError?.()}
        >
          ✗ {exit} · explain
        </button>
      ) : null}
    </div>
  );
}
