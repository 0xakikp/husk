import { useEffect } from "react";
import { setPrefs, usePrefs } from "../settings/preferences";

export function WelcomeDialog({
  onOpenFolder,
  onOpenTerminal,
  onAskHusk,
  onOpenSettings,
  onDismiss,
}: {
  onOpenFolder: () => void;
  onOpenTerminal: () => void;
  onAskHusk: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  const prefs = usePrefs();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onDismiss]);

  return (
    <div className="modal-backdrop welcome-backdrop">
      <section className="modal welcome-modal" role="dialog" aria-modal="true" aria-label="Husk is ready">
        <header className="welcome-header">
          <span>HUSK / READY</span>
          <span className="welcome-header-status"><i aria-hidden="true" /> LOCAL</span>
        </header>
        <div className="welcome-body">
          <p className="welcome-prompt">$ Workspace is standing by.</p>
          <p className="welcome-text">Open a project to start editing, running terminals, writing notes, and working with Husk AI.</p>
          <label className="welcome-name-field">
            <span>WHAT SHOULD HUSK CALL YOU? <em>OPTIONAL</em></span>
            <input
              value={prefs.userName}
              onChange={(event) => setPrefs({ userName: event.target.value })}
              placeholder="Your display name"
              maxLength={48}
              autoComplete="given-name"
            />
            <small>Saved locally. If set, your name is shared with your chosen AI model only to personalize replies.</small>
          </label>
          <button
            type="button"
            className="welcome-open-folder"
            onClick={onOpenFolder}
          >
            <span className="welcome-action-mark" aria-hidden="true">◉</span>
            <span className="welcome-action-copy"><strong>Open folder</strong><small>Choose a project or workspace</small></span>
          </button>
          <div className="welcome-actions" aria-label="Other ways to begin">
            <button type="button" onClick={onOpenTerminal}><span aria-hidden="true">›_</span> Open terminal</button>
            <button type="button" onClick={onAskHusk}><span aria-hidden="true">✦</span> Ask Husk</button>
            <button type="button" onClick={onOpenSettings}><span aria-hidden="true">⚙</span> Open settings</button>
          </div>
        </div>
        <footer className="welcome-footer">
          <span><kbd>⌘K</kbd> command palette</span>
          <span><kbd>⌘⇧B</kbd> change wallpaper</span>
          <button type="button" onClick={onDismiss}>Skip for now <kbd>Esc</kbd></button>
        </footer>
      </section>
    </div>
  );
}
