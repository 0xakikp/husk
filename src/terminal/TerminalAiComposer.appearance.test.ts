import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const css = readFileSync(new URL("./TerminalAiComposer.css", import.meta.url), "utf8");
function rule(selector: string) {
  const start = css.indexOf(selector + " {");
  expect(start, `Missing selector ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
}

it("keeps every pre-existing geometry, typography and resize declaration unchanged", () => {
  // Characterize the complete pre-flattening stylesheet, excluding paint-only
  // values. Any future intentional layout/font change must update this baseline.
  const geometry = css.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\b(?:background(?:-[a-z-]+)?|box-shadow|text-shadow|border(?:-(?:top|right|bottom|left|block|inline))?-color)\s*:[^;{}]*;/g, "")
    .replace(/\b(border(?:-(?:top|right|bottom|left|block|inline))?)\s*:\s*([^;{}]*);/g,
      (_, property: string, value: string) => `${property}: ${value.trim().split(/\s+/).slice(0, 2).join(" ")};`)
    .replace(/\s+/g, " ").trim();
  expect(createHash("sha256").update(geometry).digest("hex")).toBe("91b1451a4842d80c827a99450ec66e8ac1a278240a36bd10801ef6071b922931");
});

it("uses flat backgrounds in default, saved gradient mode, and both themes", () => {
  expect(css).not.toMatch(/(?:linear|radial|conic)-gradient\s*\(/);
  for (const selector of [".composer-panel", '.composer-panel[data-bg-style="gradient"]', '.composer-panel[data-bg-style="solid"]', '[data-theme="light"] .composer-panel', '[data-theme="light"] .composer-panel[data-bg-style="gradient"]', '[data-theme="light"] .composer-panel[data-bg-style="solid"]']) {
    expect(rule(selector)).toContain("--composer-opacity");
    expect(rule(selector)).toContain("--background");
  }
  for (const mode of ["gradient", "solid"]) expect(rule(`.composer-panel[data-bg-style="${mode}"]`)).toContain("--composer-bg-color");
  expect(rule(".composer-panel")).toContain("--composer-bg-blur");
  expect(rule(".composer-panel::before")).toContain("--composer-bg-dim");
});

it("removes decorative glow from panel, briefing, prompt, status and send actions", () => {
  for (const selector of [".composer-panel", ".composer-dock-side", ".composer-dock-left", ".project-lens-card", ".composer-pulse-dot", ".composer-resize-handle-side:active::after", ".composer-send-btn:hover:not(:disabled)", ".composer-send-btn.is-stop:hover:not(:disabled)"]) {
    expect(rule(selector)).toContain("box-shadow: none;");
  }
  for (const selector of [".wb-empty-glyph", ".wb-prompt", ".wb-status-dot"]) expect(rule(selector)).toContain("text-shadow: none;");
  expect(rule('[data-theme="light"] .composer-panel')).toContain("box-shadow: none !important;");
});

it("keeps a neutral idle input border and a crisp visible focus ring", () => {
  expect(rule(".wb-composer")).toContain("border: 1px solid var(--border);");
  expect(rule('[data-theme="light"] .wb-composer')).toContain("border-color: var(--border);");
  for (const selector of [".wb-composer:focus-within", '[data-theme="light"] .wb-composer:focus-within']) {
    expect(rule(selector)).toContain("border-color: var(--primary);");
    expect(rule(selector)).toContain("box-shadow: 0 0 0 1px color-mix(in srgb, var(--primary) 50%, transparent);");
  }
});

it("retains semantic task, stop, connection and streaming accents", () => {
  expect(rule(".task-mode-card")).toContain("var(--primary)");
  expect(rule(".composer-send-btn.is-stop")).toContain("var(--destructive)");
  expect(rule(".wb-status-dot")).toContain("color: var(--primary);");
  expect(rule(".composer-pulse-dot")).toContain("background: var(--primary);");
  expect(rule(".composer-pulse-dot")).toContain("animation: pulse-dot");
});
