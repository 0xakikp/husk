import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App";
import {
  getPrefs,
  hydratePrefsFromNative,
  preferencesForNativeConfig,
} from "./settings/preferences";
import { fontStack } from "./styles/fonts";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSentryEnabled } from "./settings/CrashReportingSection";
import { loadConfig, hydrateAiConfigFromNative } from "./ai/store";
import { loadMcpServers, hydrateMcpServersFromNative, saveMcpServers } from "./mcp/store";
import { getCustomPresets, hydrateAppearancePresetsFromNative } from "./settings/appearancePresets";
import { initialiseNativeConfig, readNativeConfig } from "./settings/nativeConfig";
import { loadAiAgentsFromFiles, migrateLegacyAiAgents } from "./ai/agentFiles";
import { initProjectProfileTracking } from "./project/profile";
/* No ?v=N cache-busting queries on these imports: the query becomes part of
   the module id, so when Tailwind finishes its cold-start candidate scan and
   invalidates the stylesheet by its plain id, the update misses this module —
   leaving the page with a partial utility sheet until a manual reload. */
import "./styles/tailwind.css";
import "./styles/fonts.css";
import "./styles/code-highlight.css";
import "./App.css";

// Initialize Sentry crash reporting only if user hasn't opted out
if (getSentryEnabled()) {
  Sentry.init({
    dsn: "https://0db29941cc9d5b5e72f11f40773f76e9@o4511596996067328.ingest.de.sentry.io/4511597291765840",
    environment: import.meta.env.MODE,
    release: "husk@" + __APP_VERSION__,
    sampleRate: 1.0,
    beforeSend(event) {
      // Strip PII: no user data, no file paths, no commands
      if (event.exception) {
        // Keep the error type and message, but scrub everything else
        return event;
      }
      return event;
    },
  });
}

const SettingsPage = React.lazy(() =>
  import("./settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

/** Wraps the settings page with focus/blur listeners that dim the window
 *  when it loses focus — a hyprland-style inactive window treatment. */
function SettingsWindowWrapper() {
  useEffect(() => {
    let unsubFocus: (() => void) | undefined;
    let unsubBlur: (() => void) | undefined;
    const setup = async () => {
      const win = getCurrentWindow();
      unsubFocus = await win.listen("tauri://focus", () => {
        document.documentElement.classList.remove("settings-unfocused");
      });
      unsubBlur = await win.listen("tauri://blur", () => {
        document.documentElement.classList.add("settings-unfocused");
      });
    };
    setup();
    return () => {
      unsubFocus?.();
      unsubBlur?.();
    };
  }, []);
  return (
    <React.Suspense fallback={<div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Loading settings…</div>}>
      <SettingsPage onClose={() => void getCurrentWindow().close()} />
    </React.Suspense>
  );
}

// Paint with the saved theme + mono font immediately, so either entry point
// (the main app or the standalone settings window) starts with the right
// colors and the chrome font. App.tsx re-applies --font-mono reactively, but
// the settings window renders SettingsPage (not App) and never runs that
// effect — so set it here too, otherwise settings would flash/stay on the
// fallback font.
function applyStartupChrome() {
  const prefs = getPrefs();
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.style.setProperty("--font-mono", fontStack(prefs.fontFamily));
}

applyStartupChrome();

// Global safety net for a Radix quirk that was freezing the window: a modal
// Dialog disables `pointer-events` on <body> while open and can leave it
// disabled if it unmounts mid-open — after which nothing in the window responds
// (you can't drag or click it). On any input, if <body> is non-interactive but
// no overlay is actually open, restore it. Capture phase + window-level so it
// fires even while the body is "none". Covers every Radix layer, not just one.
const restoreBodyInteractivity = () => {
  if (document.body.style.pointerEvents !== "none") return;
  const overlayOpen = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]',
  );
  if (!overlayOpen) document.body.style.pointerEvents = "";
};
window.addEventListener("pointerdown", restoreBodyInteractivity, true);
window.addEventListener("pointermove", restoreBodyInteractivity, true);
window.addEventListener("keydown", restoreBodyInteractivity, true);
window.addEventListener("focus", restoreBodyInteractivity);

const isSettings = new URLSearchParams(location.search).get("view") === "settings";

async function startApplication() {
  const legacyPrefs = getPrefs();
  const loaded = await readNativeConfig();
  let configLoad = loaded;

  /* Existing installs used localStorage. Before first TOML write, move custom
     agent prompts to their own Markdown files and let MCP storage shift likely
     secret environment variables into the OS keychain. If either native action
     fails, no TOML file is created and the old browser state remains intact. */
  if (!loaded.exists && !loaded.error) {
    try {
      await migrateLegacyAiAgents(legacyPrefs.aiAgents);
      await saveMcpServers(loadMcpServers());
    } catch (cause) {
      console.error("Husk settings migration was not completed", cause);
      const detail = cause instanceof Error ? cause.message : String(cause);
      // Do not create a partial TOML snapshot that excludes the old agents or
      // might copy an unprotected MCP secret. The existing local data remains
      // available, and the next launch can retry the migration safely.
      configLoad = { ...loaded, error: `Migration not completed: ${detail}` };
    }
  }

  const configDocument = await initialiseNativeConfig(configLoad, {
    config_version: 1,
    preferences: preferencesForNativeConfig(legacyPrefs),
    ai: loadConfig(),
    mcp: { servers: loadMcpServers() },
    appearance_presets: { items: getCustomPresets() },
  });

  let agents = legacyPrefs.aiAgents;
  try {
    const loadedAgents = await loadAiAgentsFromFiles();
    agents = loadedAgents.agents;
    if (loadedAgents.errors.length) {
      console.warn("Some Husk agent files could not be loaded", loadedAgents.errors);
    }
  } catch (cause) {
    console.error("Husk agent files could not be loaded", cause);
  }

  hydratePrefsFromNative(configDocument.preferences, agents);
  hydrateAiConfigFromNative(configDocument.ai);
  hydrateMcpServersFromNative(configDocument.mcp);
  hydrateAppearancePresetsFromNative(configDocument.appearance_presets);
  applyStartupChrome();
  initProjectProfileTracking();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {isSettings ? <SettingsWindowWrapper /> : <App />}
    </React.StrictMode>,
  );
}

void startApplication();
