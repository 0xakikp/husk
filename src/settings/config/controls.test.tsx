// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CfgBlock, CfgBool, CfgColor, CfgEnum, CfgRow, CfgSlider, CfgText } from "./controls";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (node: React.ReactNode) => { await act(async () => root.render(node)); };
const label = (node: HTMLElement) => document.getElementById(node.getAttribute("aria-labelledby") ?? "")?.textContent;
const descriptions = (node: HTMLElement) => node.getAttribute("aria-describedby")?.split(" ").map(id => document.getElementById(id)?.textContent);

it("exposes a named keyboard-native switch with checked and disabled state", async () => {
  const change = vi.fn();
  await render(<CfgRow name="showWelcomeOnStartup" comment="Show on app launch."><CfgBool value onChange={change} /></CfgRow>);
  const button = host.querySelector("button")!;
  expect(button.type).toBe("button"); expect(button.getAttribute("role")).toBe("switch");
  expect(button.getAttribute("aria-checked")).toBe("true"); expect(label(button)).toBe("Show Welcome On Startup");
  expect(descriptions(button)?.join(" ")).toContain("Show on app launch.");
  await act(async () => button.click()); expect(change).toHaveBeenCalledWith(false);
  await render(<CfgRow name="showWelcomeOnStartup"><CfgBool value={false} disabled onChange={change} /></CfgRow>);
  expect(button.disabled).toBe(true); expect(button.getAttribute("aria-checked")).toBe("false");
  await act(async () => button.click()); expect(change).toHaveBeenCalledOnce();
});

it("associates visible labels, hints and errors and removes error state after correction", async () => {
  await render(<CfgRow name="command" comment="Executable name." error="A command is required."><CfgText value="" onChange={() => {}} /></CfgRow>);
  const input = host.querySelector("input")!;
  expect(label(input)).toBe("Command"); expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(descriptions(input)).toEqual(["# Executable name.", "A command is required."]);
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("A command is required.");
  await render(<CfgRow name="command" comment="Executable name."><CfgText value="node" onChange={() => {}} /></CfgRow>);
  expect(input.hasAttribute("aria-invalid")).toBe(false); expect(descriptions(input)).toEqual(["# Executable name."]);
});

it("labels comment-only fields and gives independent rows distinct accessible IDs", async () => {
  await render(<><CfgRow comment="First value"><CfgText value="a" onChange={() => {}} /></CfgRow><CfgRow name="secondValue"><CfgText value="b" onChange={() => {}} /></CfgRow></>);
  const [first, second] = host.querySelectorAll("input");
  expect(label(first)).toBe("# First value"); expect(label(second)).toBe("Second Value");
  expect(first.getAttribute("aria-labelledby")).not.toBe(second.getAttribute("aria-labelledby"));
});

it("preserves numeric option values rather than leaking select strings into preferences", async () => {
  const change = vi.fn();
  await render(<CfgRow name="fontSize"><CfgEnum value={12} options={[{ value: 12, label: "12px" }, { value: 16, label: "16px" }]} onChange={change} /></CfgRow>);
  const select = host.querySelector("select")!;
  expect(label(select)).toBe("Font Size");
  await act(async () => { select.value = "16"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(change).toHaveBeenCalledWith(16);
  await act(async () => { select.value = "unlisted"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(change).toHaveBeenCalledOnce();
});

it("caps long text fields and preserves password masking", async () => {
  await render(<><CfgRow name="path"><CfgText value={"/fixture/".repeat(80)} widthCh={200} onChange={() => {}} /></CfgRow><CfgRow name="token"><CfgText secret value="fixture-only" onChange={() => {}} /></CfgRow></>);
  const [path, token] = host.querySelectorAll("input");
  expect(path.size).toBe(36); expect(path.value.length).toBeGreaterThan(36);
  expect(token.type).toBe("password"); expect(token.autocomplete).toBe("off"); expect(label(token)).toBe("Token");
});

it("names color presets and exposes the selected swatch without relying on color alone", async () => {
  const change = vi.fn();
  await render(<CfgRow name="accentColor"><CfgColor value="#11C700" presets={["#11c700", "#ff3366"]} onChange={change} /></CfgRow>);
  const color = host.querySelector("input")!;
  expect(label(color)).toBe("Accent Color");
  const [selected, other] = host.querySelectorAll("button");
  expect(selected.getAttribute("aria-label")).toBe("Accent Color: #11c700");
  expect(selected.getAttribute("aria-pressed")).toBe("true"); expect(other.getAttribute("aria-pressed")).toBe("false");
  await act(async () => other.click()); expect(change).toHaveBeenCalledWith("#ff3366");
});

it("exposes range limits and readable units for screen readers", async () => {
  await render(<CfgRow name="blur"><CfgSlider value={12} min={0} max={32} step={2} unit="px" onChange={() => {}} /></CfgRow>);
  const range = host.querySelector("input")!;
  expect(label(range)).toBe("Blur"); expect(range.type).toBe("range");
  expect(range.min).toBe("0"); expect(range.max).toBe("32"); expect(range.step).toBe("2");
  expect(range.getAttribute("aria-valuetext")).toBe("12px");
});

it("labels multiline editors and preserves their native read-only behavior", async () => {
  await render(<CfgRow name="customCSS" comment="Advanced styling."><CfgBlock value=".fixture {}" readOnly rows={6} /></CfgRow>);
  const textarea = host.querySelector("textarea")!;
  expect(label(textarea)).toBe("Custom CSS"); expect(descriptions(textarea)?.join(" ")).toContain("Advanced styling.");
  expect(textarea.readOnly).toBe(true); expect(textarea.getAttribute("rows")).toBe("6");
});
