// @vitest-environment happy-dom
import { act, createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CompactButton, CompactForm, CompactInput, CompactLabel, CompactSelect, CompactTextarea } from "./compact-form";

let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("uses shared opt-in classes while forwarding refs, labels, native changes and ARIA", async () => {
  const field = createRef<HTMLInputElement>(); const textarea = createRef<HTMLTextAreaElement>(); const select = createRef<HTMLSelectElement>(); const changed = vi.fn();
  await act(async () => root.render(createElement(CompactForm, null,
    createElement(CompactLabel, { htmlFor: "name" }, "Name"),
    createElement(CompactInput, { id: "name", ref: field, defaultValue: "Name", "aria-invalid": true, "aria-describedby": "name-error", onChange: changed }),
    createElement(CompactTextarea, { ref: textarea, defaultValue: "printf hello", rows: 3 }),
    createElement(CompactSelect, { ref: select, defaultValue: "one" }, createElement("option", { value: "one" }, "One")),
  )));
  expect(container.querySelector(".compact-form")).not.toBeNull();
  expect(container.querySelector("label")?.htmlFor).toBe("name");
  for (const element of [field.current, textarea.current, select.current]) expect(element?.classList.contains("compact-control")).toBe(true);
  expect(field.current?.getAttribute("aria-invalid")).toBe("true"); expect(field.current?.getAttribute("aria-describedby")).toBe("name-error");
  expect(textarea.current?.getAttribute("rows")).toBe("3"); expect(select.current?.value).toBe("one");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field.current, "Edited"); field.current!.dispatchEvent(new Event("input", { bubbles: true })); });
  expect(changed).toHaveBeenCalledOnce();
});
it("keeps primary/secondary actions and disabled controls consistent without implicit submission", async () => {
  const clicked = vi.fn();
  await act(async () => root.render(createElement(CompactForm, null,
    createElement(CompactButton, { variant: "primary", onClick: clicked }, "Save"),
    createElement(CompactButton, { variant: "ghost", compact: true, disabled: true, onClick: clicked }, "Cancel"),
    createElement(CompactButton, { icon: true, "aria-label": "Close" }, "×"),
  )));
  const buttons = container.querySelectorAll("button");
  expect([...buttons].every((button) => button.type === "button" && button.classList.contains("compact-button"))).toBe(true);
  expect(buttons[0].dataset.compactVariant).toBe("primary"); expect(buttons[1].dataset.compactSize).toBe("small");
  await act(async () => buttons[1].click()); expect(clicked).not.toHaveBeenCalled();
  expect(buttons[2].getAttribute("aria-label")).toBe("Close");
});
it("centralizes theme/density and leaves workflow CSS structural instead of overriding controls", () => {
  // Vitest stubs CSS imports in DOM tests; inspect the opt-in stylesheet itself.
  const css = readFileSync(resolve("src/components/compact-form.css"), "utf8");
  const workflow = readFileSync(resolve("src/workflows/workflowUi.css"), "utf8");
  expect(css).toMatch(/\.compact-control\s*\{[^}]*height: 32px/);
  expect(css).toMatch(/\.compact-button\s*\{[^}]*height: 28px/);
  expect(css).toMatch(/\.compact-panel,\s*\.sidebar-sheet-panel\.compact-panel\s*\{[^}]*background: var\(--background\)/);
  expect(css).toMatch(/\.sidebar-sheet-panel\.compact-panel\s*\{[^}]*box-shadow: none/);
  expect(css).toMatch(/\.compact-section\s*\{[^}]*padding: 0; border: 0/);
  expect(css).toContain("var(--ring, var(--primary))"); expect(css).toContain("var(--destructive)");
  expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  expect(workflow).not.toMatch(/\.wf-form\s+(?:button|fieldset|:is\(input)/);
  const bar = workflow.match(/\.workflow-draft-bar\s*\{([^}]*)\}/)?.[1];
  expect(bar).toContain("display: flex"); expect(bar).not.toMatch(/position:\s*(fixed|absolute)/);
  const editor = workflow.match(/\.workflow-sidebar-editor\s*\{([^}]*)\}/)?.[1];
  expect(editor).toContain("width: 100%");
  expect(editor).not.toMatch(/(?:background|border|color):/);
  expect(workflow).not.toContain(".workflow-dock");
});
it("excludes compact panels from legacy sidebar density rules regardless of stylesheet order", () => {
  const css = readFileSync(resolve("src/App.css"), "utf8");
  const legacy = css.slice(css.indexOf("/* ── Sheet form scale"), css.indexOf("@keyframes sheet-in"));
  const selectors = [...legacy.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)].map((rule) => rule[1].trim());
  expect(selectors).toHaveLength(8);
  for (const sheet of [true, false]) {
    container.innerHTML = `<div class="${sheet ? "sidebar-sheet-panel compact-panel" : "sidebar-sheet"}">${sheet ? "" : '<div class="compact-panel">'}
      <label class="compact-label">Name</label><input class="compact-control"><select class="compact-control"></select>
      <textarea class="compact-control"></textarea><button class="compact-button">Save</button><button class="size-8">Color</button>
      <div class="gap-4"></div><div class="gap-3"></div><div class="space-y-4"><span></span><span></span></div>
      ${sheet ? "" : "</div>"}</div>`;
    for (const selector of selectors) expect(container.querySelectorAll(selector).length, selector).toBe(0);
    container.querySelector(".compact-panel")!.classList.remove("compact-panel");
    for (const selector of selectors) expect(container.querySelectorAll(selector).length, selector).toBeGreaterThan(0);
  }
});
