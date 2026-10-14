import { getSessionHandle } from "./registry";

/** Pane chrome is outside xterm: it never becomes terminal output or history. */
export function TerminalPaneHeader({ leafId, label, active, onFocus, onClose }: {
  leafId: number;
  label: string;
  active: boolean;
  onFocus: () => void;
  onClose: () => void;
}) {
  return <div className="pane-header">
    <button
      type="button"
      className="pane-label"
      aria-label={`Focus ${label}`}
      aria-pressed={active}
      title={`Focus ${label}`}
      onClick={() => {
        onFocus();
        // Even the already-active pane needs DOM focus back from this button.
        getSessionHandle(leafId)?.focus();
      }}
    >
      <svg className="pane-label-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
        <path d="m4 6 2 2-2 2m4 0h3" />
      </svg>
      <span className="pane-label-text">{label}</span>
      {active && <span className="pane-active-label">Active</span>}
    </button>
    <button type="button" className="pane-close" aria-label={`Close ${label}`} title={`Close ${label}`} onClick={onClose}>×</button>
  </div>;
}
