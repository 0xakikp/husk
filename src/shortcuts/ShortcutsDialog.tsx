const SHORTCUTS = [
  { keys: "⌘/Ctrl K", desc: "Command palette" },
  { keys: "⌘/Ctrl F", desc: "Find in terminal" },
  { keys: "⌘/Ctrl +  /  −  /  0", desc: "Zoom in / out / reset" },
  { keys: "⌘/Ctrl S", desc: "Save file (editor)" },
  { keys: "⌘/Ctrl T", desc: "New terminal tab" },
  { keys: "⌘/Ctrl W", desc: "Close terminal tab" },
  { keys: "⌘/Ctrl Tab", desc: "Next terminal tab" },
  { keys: "⌘/Ctrl Shift Tab", desc: "Previous terminal tab" },
  { keys: "⌘/Ctrl 1–9", desc: "Switch to tab 1–9" },
  { keys: "Enter / Shift+Enter", desc: "Next / previous terminal match" },
  { keys: "Esc", desc: "Close dialogs / search" },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Keyboard shortcuts</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {SHORTCUTS.map((s) => (
            <div key={s.desc} className="sc-shortcut">
              <span>{s.desc}</span>
              <kbd className="sc-kbd">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
