import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useClipHistory, clearClips } from "./store";
import { toast } from "../toast";

export function ClipboardManager({ onClose }: { onClose: () => void }) {
  const history = useClipHistory();

  const copy = (t: string) => {
    void writeText(t);
    toast({ title: "Copied to clipboard", variant: "info" });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Clipboard history" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Clipboard history</span>
          <span className="modal-head-actions">
            <button type="button" className="ai-icon" title="Clear" onClick={clearClips}>
              🗑
            </button>
            <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
              ×
            </button>
          </span>
        </div>
        <div className="modal-body">
          {history.length === 0 ? (
            <p className="rb-empty">
              Nothing captured yet. Copy something and it'll show up here.
            </p>
          ) : (
            <div className="rb-list">
              {history.map((t, i) => (
                <button
                  key={`${i}-${t.slice(0, 12)}`}
                  type="button"
                  className="clip-item"
                  title="Copy"
                  onClick={() => copy(t)}
                >
                  {t.length > 140 ? `${t.slice(0, 140)}…` : t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
