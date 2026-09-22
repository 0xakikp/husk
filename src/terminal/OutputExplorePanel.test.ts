// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OutputExplorePanel } from "./OutputExplorePanel";
import { captureOutput } from "./outputExplore";

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(text: string, onClose = vi.fn()) {
  const snapshot = captureOutput(text.split("\n").map((line, index) => ({ id: index + 10, text: line })), "Selected output");
  await act(async () => root.render(createElement(OutputExplorePanel, { snapshot, onClose })));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent === label || element.getAttribute("aria-label") === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}

it("shows an exact local table then a zero-based chart with links back to frozen evidence", async () => {
  await render("task,duration\ncompile,2ms\ntest,4ms");
  expect(container.textContent).toContain("Nothing is sent to AI");
  expect([...container.querySelectorAll("tbody td")].map((cell) => cell.textContent)).toEqual(["compile", "2ms", "L11", "test", "4ms", "L12"]);
  await click("Chart");
  expect([...container.querySelectorAll<HTMLElement>(".output-explore-bar-track > span")].map((bar) => bar.style.width)).toEqual(["50%", "100%"]);
  await click("Row 2: test, duration 4ms. Show source");
  expect(container.querySelector('[aria-label="Frozen output source"] .selected')?.textContent).toBe("L12test,4ms");
  expect(container.querySelector("table")).toBeNull();
});

it("filters captured rows locally without changing their original source mapping", async () => {
  await render("task,duration\ncompile,2ms\ntest,4ms");
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "test");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  expect(container.textContent).toContain("1 of 2 rows");
  await click("Show source for row 2");
  expect(container.querySelector(".selected")?.textContent).toBe("L12test,4ms");
});

it("renders terminal markup as text, never as HTML or executable chart content", async () => {
  await render('[{"name":"<img src=x onerror=alert(1)>","time":2}]');
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  await click("Chart");
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector(".output-explore-bar-label")?.textContent).toContain("<img");
});

it("sorts exact numeric values while source links retain the original row identity", async () => {
  await render("task,duration\ncompile,12ms\ntest,4ms");
  await click("Sort by duration");
  expect(container.querySelector("tbody tr")?.textContent).toBe("test4msL12");
  expect(container.querySelector('[aria-sort="ascending"]')?.textContent).toContain("duration");
  await click("Sort by duration");
  expect(container.querySelector("tbody tr")?.textContent).toBe("compile12msL11");
  await click("Show source for row 1");
  expect(container.querySelector(".selected")?.textContent).toBe("L11compile,12ms");
});

it("shows unsupported output as text with exact clickable section headings", async () => {
  await render("### Build\ncompiling...\nerror: file missing");
  expect(container.querySelector("table")).toBeNull();
  expect(container.textContent).toContain("Text view only");
  await click("L12 · error: file missing");
  expect(container.querySelector(".selected")?.textContent).toBe("L12error: file missing");
});

it("does not offer misleading charts for mixed units", async () => {
  await render("task,time\ncompile,100ms\ntest,1s");
  expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Chart")).toBe(false);
  expect(container.textContent).toContain("Chart unavailable");
});

it("keeps repeated labels as distinct chart bars and supports all-zero values", async () => {
  await render("task,value\nworker,0\nworker,0"); await click("Chart");
  expect(container.querySelectorAll(".output-explore-bar-row")).toHaveLength(2);
  expect([...container.querySelectorAll<HTMLElement>(".output-explore-bar-track > span")].map((bar) => bar.style.width)).toEqual(["0%", "0%"]);
});

it("closes with Escape", async () => {
  const onClose = vi.fn(); await render("some output", onClose);
  await act(async () => container.querySelector("section")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(onClose).toHaveBeenCalledOnce();
});
