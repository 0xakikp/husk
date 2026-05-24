import { setPrefs } from "../settings/preferences";

export function WelcomeDialog() {
  return (
    <div className="modal-backdrop">
      <div className="modal welcome-modal" role="dialog" aria-label="Welcome to huskv2">
        <div className="welcome-body">
          <img src="/logo.png" className="welcome-logo" alt="huskv2" />
          <h2 className="welcome-title">Welcome to huskv2</h2>
          <p className="welcome-text">
            A terminal with built-in AI and a code editor. Open the AI panel with
            <b> ✦ AI</b>, browse files with <b>☰ Files</b>, and reach MCP servers,
            runbooks, and 2FA from the title bar.
          </p>
          <button
            type="button"
            className="welcome-cta"
            onClick={() => setPrefs({ hasSeenWelcome: true })}
          >
            Get started
          </button>
        </div>
      </div>
    </div>
  );
}
