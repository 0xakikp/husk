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
              {history.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  className="clip-item"
                  title="Copy"
                  onClick={() => copy(it.text)}
                >
                  {it.text.length > 140 ? `${it.text.slice(0, 140)}…` : it.text}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
