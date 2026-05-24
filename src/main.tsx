import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsPage } from "./settings/SettingsPage";
import { getPrefs } from "./settings/preferences";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

// Paint with the saved theme immediately, so either entry point (the main app
// or the standalone settings window) starts with the right colors.
document.documentElement.dataset.theme = getPrefs().theme;
document.documentElement.dataset.termTheme = getPrefs().terminalTheme;

const isSettings = new URLSearchParams(location.search).get("view") === "settings";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isSettings ? (
      <SettingsPage onClose={() => void getCurrentWindow().close()} />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
