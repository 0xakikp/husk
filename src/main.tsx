import React from "react";
import ReactDOM from "react-dom/client";
import {
  getPrefs,
  hydratePrefsFromNative,
  preferencesForNativeConfig,
} from "./settings/preferences";
import { applyWindowChrome } from "./settings/windowChrome";
import { initialiseCrashReporting } from "./settings/crashReporting";
import { loadConfig, hydrateAiConfigFromNative, initKeys, initialiseAiSync } from "./ai/store";
import { loadMcpServers, hydrateMcpServersFromNative, saveMcpServers } from "./mcp/store";
import { getCustomPresets, hydrateAppearancePresetsFromNative } from "./settings/appearancePresets";
import { initialiseNativeConfig, readNativeConfig, subscribeNativeConfigDocument } from "./settings/nativeConfig";
import { loadAiAgentsFromFiles, migrateLegacyAiAgents } from "./ai/agentFiles";
import { initialiseWorkflowStore } from "./workflows/store";
/* No ?v=N cache-busting queries on these imports: the query becomes part of
   the module id, so when Tailwind finishes its cold-start candidate scan and
   invalidates the stylesheet by its plain id, the update misses this module —
   leaving the page with a partial utility sheet until a manual reload. */
import "./styles/tailwind.css";
import "./styles/fonts.css";
import "./styles/code-highlight.css";
import "./App.css";

// Opted-out launches never load the SDK. The live controller also handles
// consent changes made in this or another window, including startup races.
const stopCrashReporting = initialiseCrashReporting();
if (import.meta.hot) import.meta.hot.dispose(stopCrashReporting);

const App = React.lazy(() => import("./App"));
const SettingsWindow = React.lazy(() => import("./settings/SettingsWindow").then((module) => ({ default: module.SettingsWindow })));

// Paint both entry points consistently before React mounts. Each window then
// uses the same reactive hook, including accent and custom CSS changes.
applyWindowChrome(getPrefs());

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
  const [loaded] = await Promise.all([
    readNativeConfig(),
    initialiseWorkflowStore(),
    // Migrate legacy keys before hydrateAiConfigFromNative rewrites config.
    // This also initializes credentials in the standalone Settings window.
    initKeys(),
  ]);
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
  const stopConfigSync = subscribeNativeConfigDocument((document) => {
    // These are authoritative updates, not new edits. Hydration must not echo
    // the other window's changes back into the persistence queue.
    hydrateAiConfigFromNative(document.ai);
    hydrateMcpServersFromNative(document.mcp);
    hydrateAppearancePresetsFromNative(document.appearance_presets);
  });
  if (import.meta.hot) import.meta.hot.dispose(stopConfigSync);
  applyWindowChrome(getPrefs());

  await initialiseAiSync();
  if (!isSettings) {
    const { initialiseSessionPersistence } = await import("./ai/sessionStore");
    await initialiseSessionPersistence();
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {isSettings ? (
        <React.Suspense fallback={<div className="h-full bg-background" />}>
          <SettingsWindow />
        </React.Suspense>
      ) : (
        <React.Suspense fallback={<div className="h-full bg-background" />}>
          <App />
        </React.Suspense>
      )}
    </React.StrictMode>,
  );
}

void startApplication();
