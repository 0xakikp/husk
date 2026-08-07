import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdates } from "../../updater";
import { ConfigEditor } from "../config/controls";
import { useNativeConfigStatus } from "../nativeConfig";

const REPO_URL = "https://github.com/0xakikp/husk";
const FEEDBACK_URL = "https://github.com/0xakikp/husk/issues/new";
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/akikp";

function platformLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Win")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  return "desktop";
}

type Capability = {
  label: string;
  summary: string;
};

const CAPABILITIES: Capability[] = [
  {
    label: "Terminal",
    summary: "Shells, panes, output, and logs",
  },
  {
    label: "Workspace",
    summary: "Files, diffs, and Vault notes",
  },
  {
    label: "AI",
    summary: "Context with clear boundaries",
  },
  {
    label: "Operations",
    summary: "Git, remotes, and tool views",
  },
];

export function ManifestFile() {
  const [version, setVersion] = useState("");
  const config = useNativeConfigStatus();

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.7.5"));
  }, []);

  const configPath = config.path ?? "~/.husk/config.toml";
  const configState = config.error
    ? "Local settings need attention"
    : config.ready
      ? "Local settings ready"
      : "Preparing local settings";

  return (
    <ConfigEditor>
      <div className="about-workbench">
        <section className="about-profile" aria-label="About Husk">
          <header className="about-profile-header">
            <div className="about-hero-mark" aria-hidden="true">
              <img src="/logo.png" alt="" draggable={false} />
            </div>
            <div className="about-hero-copy">
              <p className="about-kicker">HUSK</p>
              <h2>Terminal-native workspace</h2>
              <p>Build, operate, and understand your systems from one terminal-native workspace.</p>
              <div className="about-build-line" aria-label="Build information">
                <span>Husk {version || "…"}</span>
                <i />
                <span>{platformLabel()}</span>
                <i />
                <span>MIT licensed</span>
              </div>
            </div>
            <div className="about-hero-actions">
              <button type="button" className="about-primary-action" onClick={() => void checkForUpdates(true)}>check for updates</button>
              <button type="button" className="about-text-action" onClick={() => void openUrl(REPO_URL)}>view on GitHub ↗</button>
            </div>
          </header>

          <div className="about-profile-divider" />

          <section className="about-profile-section" aria-label="Husk capabilities">
            <p className="about-kicker">AT A GLANCE</p>
            <div className="about-capability-strip">
              {CAPABILITIES.map((capability) => (
                <article key={capability.label} className="about-capability-item">
                  <strong>{capability.label}</strong>
                  <span>{capability.summary}</span>
                </article>
              ))}
            </div>
          </section>

          <div className="about-profile-divider" />

          <details className="about-trust-disclosure">
            <summary>
              <span>
                <b>Private by default</b>
                <small>Preferences, agents, and notes stay local. API and integration secrets use the operating system keychain.</small>
              </span>
            </summary>
            <div className="about-trust-details">
              <dl className="about-trust-map">
                <div className={`about-trust-row${config.error ? " is-attention" : ""}`}>
                  <dt>Configuration</dt>
                  <dd><code>{configPath}</code><small><i className="about-status-dot" />{configState}. Non-secret preferences and presets live here.</small>{config.error ? <em>{config.error}</em> : null}</dd>
                </div>
                <div className="about-trust-row">
                  <dt>Credentials</dt>
                  <dd><b>Operating system keychain</b><small>API and integration secrets stay out of the config file.</small></dd>
                </div>
                <div className="about-trust-row">
                  <dt>AI requests</dt>
                  <dd><b>Selected provider, on request</b><small>Only terminal output, files, attachments, or memory you include are sent.</small></dd>
                </div>
                <div className="about-trust-row">
                  <dt>Your files</dt>
                  <dd><code>~/.husk/agents/ · ~/.husk/notes/</code><small>Custom agents and Vault notes remain editable, local Markdown.</small></dd>
                </div>
              </dl>
            </div>
          </details>

          <div className="about-profile-divider" />

          <section className="about-profile-section about-next-section">
            <p className="about-kicker">START HERE</p>
            <div className="about-next-grid">
              <div><kbd>⌘/Ctrl K</kbd><span>Command palette and Beautiful Logs</span></div>
              <div><kbd>AI &amp; Models</kbd><span>Choose API access or a CLI subscription</span></div>
              <div><kbd>Privacy</kbd><span>Control optional crash reporting</span></div>
            </div>
          </section>

          <footer className="about-footer">
            <p>Husk is open source under the MIT License.</p>
            <div>
              <button type="button" onClick={() => void openUrl(FEEDBACK_URL)}>report an issue ↗</button>
              <button type="button" onClick={() => void openUrl(BUY_ME_A_COFFEE_URL)}>support Husk ↗</button>
            </div>
          </footer>
        </section>
      </div>
    </ConfigEditor>
  );
}
