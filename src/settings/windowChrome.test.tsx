// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Prefs } from "./preferences";
const fixture = vi.hoisted(() => ({ prefs: {} as Prefs }));
vi.mock("./preferences", () => ({ usePrefs: () => fixture.prefs }));
import { applyWindowChrome, useWindowChrome } from "./windowChrome";
import { fontStack } from "../styles/fonts";
let root: Root, host: HTMLDivElement;
function Chrome() { useWindowChrome(); return null; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.prefs = { theme: "dark", fontFamily: "jetbrains", accentColor: "#11c700", panelGaps: 8, activePanelGlow: true, customCSS: ".fixture { color: red; }" } as Prefs;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getElementById("husk-custom-css")?.remove(); });

it("applies the same theme, font, accent, panel effects, and custom CSS before mounting", () => {
  applyWindowChrome(fixture.prefs);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(fontStack(fixture.prefs.fontFamily));
  expect(document.documentElement.style.getPropertyValue("--accent")).toBe("#11c700");
  expect(document.documentElement.style.getPropertyValue("--accent-rgb")).toBe("17 199 0");
  expect(document.documentElement.style.getPropertyValue("--panel-gaps")).toBe("8px");
  expect(document.documentElement.style.getPropertyValue("--active-gap-glow")).toContain("var(--accent)");
  expect(document.querySelectorAll("#husk-custom-css")).toHaveLength(1);
  expect(document.getElementById("husk-custom-css")?.textContent).toBe(fixture.prefs.customCSS);
});

it("reactively updates standalone chrome and removes cleared custom CSS without duplicate styles", async () => {
  await act(async () => root.render(<Chrome />));
  const style = document.getElementById("husk-custom-css");
  fixture.prefs = { ...fixture.prefs, accentColor: "#ff3366", theme: "light", fontFamily: "fira", panelGaps: 12, activePanelGlow: false, customCSS: ".fixture { color: blue; }" };
  await act(async () => root.render(<Chrome />));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(document.documentElement.style.getPropertyValue("--font-mono")).toBe(fontStack("fira"));
  expect(document.documentElement.style.getPropertyValue("--accent-rgb")).toBe("255 51 102");
  expect(document.documentElement.style.getPropertyValue("--active-gap-glow")).toBe("transparent");
  expect(document.getElementById("husk-custom-css")).toBe(style);
  expect(style?.textContent).toBe(".fixture { color: blue; }");
  fixture.prefs = { ...fixture.prefs, customCSS: "" };
  await act(async () => root.render(<Chrome />));
  expect(document.getElementById("husk-custom-css")).toBeNull();
});
