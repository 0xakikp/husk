import { useEffect, useState } from "react";
import { isRepo, log } from "./client";

export function GitHistoryDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState<string | null | "loading">("loading");

  useEffect(() => {
    void (async () => {
      setText((await isRepo()) ? await log() : null);
    })();
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal docker-modal" role="dialog" aria-label="Git history" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Git History</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {text === "loading" ? (
            <p className="rb-empty">Loading…</p>
          ) : text === null ? (
            <p className="rb-empty">Not a git repository.</p>
          ) : (
            <pre className="sc-diff-pre">{text}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
