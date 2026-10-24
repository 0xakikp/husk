import { useEffect } from "react";
import { fontStack } from "../styles/fonts";
import { usePrefs, type Prefs } from "./preferences";

/** Both the workspace and standalone Settings use the same live chrome. */
export function applyWindowChrome(prefs: Prefs, target = document): void {
  const root = target.documentElement;
  root.dataset.theme = prefs.theme;
  root.style.setProperty("--font-mono", fontStack(prefs.fontFamily));
  root.style.setProperty("--accent", prefs.accentColor);
  const r = parseInt(prefs.accentColor.slice(1, 3), 16);
  const g = parseInt(prefs.accentColor.slice(3, 5), 16);
  const b = parseInt(prefs.accentColor.slice(5, 7), 16);
  root.style.setProperty("--accent-rgb", `${r} ${g} ${b}`);
  root.style.setProperty("--panel-gaps", `${prefs.panelGaps}px`);
  root.style.setProperty("--active-gap-glow", prefs.activePanelGlow ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "transparent");

  const existing = target.getElementById("husk-custom-css");
  if (!prefs.customCSS) {
    existing?.remove();
    return;
  }
  if (existing?.textContent === prefs.customCSS) return;
  const style = existing ?? target.createElement("style");
  style.id = "husk-custom-css";
  style.textContent = prefs.customCSS;
  if (!existing) target.head.appendChild(style);
}

export function useWindowChrome(): void {
  const prefs = usePrefs();
  useEffect(() => {
    applyWindowChrome(prefs);
  }, [prefs.theme, prefs.fontFamily, prefs.accentColor, prefs.panelGaps, prefs.activePanelGlow, prefs.customCSS]);
}
