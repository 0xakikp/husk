import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { setPrefs, usePrefs } from "../settings/preferences";
import "./WelcomeDialog.css";

export function WelcomeDialog({
  onOpenFolder,
  onOpenTerminal,
  onAskHusk,
  onOpenSettings,
  onDismiss,
  workspacePath,
  terminalCount = 0,
}: {
  onOpenFolder: () => void | Promise<void>;
  onOpenTerminal: () => void;
  onAskHusk: () => void;
  onOpenSettings: () => void;
  onDismiss: () => void;
  workspacePath?: string;
  terminalCount?: number;
}) {
  const prefs = usePrefs();
  const returning = prefs.hasSeenWelcome;
  const userName = typeof prefs.userName === "string" ? prefs.userName : "";
  const name = userName.trim();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const openingFolder = useRef(false);
  const [folderBusy, setFolderBusy] = useState(false);
  const [folderError, setFolderError] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function openFolder() {
    if (openingFolder.current) return;
    openingFolder.current = true;
    setFolderBusy(true);
    setFolderError(false);
    try {
      // The owner decides whether a chosen folder closes the welcome. Cancelling
      // the native picker must leave this screen available.
      await onOpenFolder();
    } catch {
      if (mounted.current) setFolderError(true);
    } finally {
      openingFolder.current = false;
      if (mounted.current) setFolderBusy(false);
    }
  }

  const nameField = (
    <label className="welcome-start__name">
      <span>What should Husk call you? <small>Optional</small></span>
      <input value={userName} onChange={(event) => setPrefs({ userName: event.target.value })} placeholder="Your display name" maxLength={48} autoComplete="given-name" />
      <small>Saved locally. When you use AI, your name is shared with your chosen model to personalize replies.</small>
    </label>
  );

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="welcome-start-overlay" />
        <Dialog.Content
          ref={contentRef}
          className="welcome-start"
          aria-modal="true"
          onPointerDownOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            primaryRef.current?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Do not steal focus from a settings/AI dialog opened by an action.
            if (previousFocus.current?.isConnected && (document.activeElement === document.body || contentRef.current?.contains(document.activeElement))) previousFocus.current.focus();
          }}
        >
          <header className="welcome-start__header">
            <span><i aria-hidden="true" /> HUSK / WELCOME</span>
            <Dialog.Close className="welcome-start__close" aria-label="Close welcome" title="Close welcome (Esc)">×</Dialog.Close>
          </header>
          <div className="welcome-start__body">
            <div className="welcome-start__intro">
              <Dialog.Title className="welcome-start__title">{returning ? `Welcome back${name ? `, ${name}` : ""}.` : "Your workspace starts here."}</Dialog.Title>
              <Dialog.Description className="welcome-start__description">
                {returning ? "Pick up where you left off, or open another project." : `Open a project for your terminals, files, and notes${prefs.aiEnabled ? "—with Husk AI nearby" : ""}.`}
              </Dialog.Description>
            </div>
            {!returning && nameField}
            <button ref={primaryRef} type="button" className="welcome-start__primary" disabled={!returning && folderBusy} onClick={returning ? onDismiss : openFolder}>
              <span className="welcome-start__mark" aria-hidden="true">{returning ? "›_" : "◉"}</span>
              <span className="welcome-start__primary-copy">
                <strong>{returning ? "Continue workspace" : folderBusy ? "Opening picker…" : "Open folder"}</strong>
                <small title={returning ? workspacePath : undefined}>{returning ? workspacePath ? `Current workspace · ${workspacePath}` : "Return to your tabs and terminals" : "Choose a project or workspace"}</small>
              </span>
              <span className="welcome-start__arrow" aria-hidden="true">→</span>
            </button>
            {returning && terminalCount > 0 && <p className="welcome-start__workspace-note">{terminalCount} terminal {terminalCount === 1 ? "tab" : "tabs"} in this workspace · Commands are not replayed</p>}
            <div className={`welcome-start__actions${returning ? " welcome-start__actions--returning" : ""}`} aria-label="Other ways to begin">
              {returning && <button type="button" disabled={folderBusy} onClick={openFolder}><span aria-hidden="true">◉</span>{folderBusy ? "Opening picker…" : "Open folder"}</button>}
              <button type="button" onClick={onOpenTerminal}><span aria-hidden="true">›_</span>Open terminal</button>
              {prefs.aiEnabled && <button type="button" onClick={onAskHusk}><span aria-hidden="true">✦</span>Ask Husk</button>}
              <button type="button" onClick={onOpenSettings}><span aria-hidden="true">⚙</span>Settings</button>
            </div>
            {folderError && <p className="welcome-start__error" role="alert">Could not open the folder picker. Please try again.</p>}
            {returning && <details className="welcome-start__personalize"><summary>Personalize your greeting</summary>{nameField}</details>}
          </div>
          <footer className="welcome-start__footer">
            <label><input type="checkbox" checked={prefs.showWelcomeOnStartup} onChange={(event) => setPrefs({ showWelcomeOnStartup: event.target.checked })} />Show on startup</label>
            <Dialog.Close className="welcome-start__skip">{returning ? "Not now" : "Skip for now"} <kbd>Esc</kbd></Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
