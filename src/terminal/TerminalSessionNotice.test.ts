// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalSessionNotice } from "./TerminalSessionNotice";
import type { TerminalSessionStatus } from "./sessionLifecycle";

let root: Root;
let container: HTMLDivElement;
const onCheck = vi.fn(async () => {});
const onRestart = vi.fn(async () => {});
const onHostMouseDown = vi.fn();
const onHostClick = vi.fn();
const onHostKeyDown = vi.fn();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  onCheck.mockReset().mockResolvedValue(undefined);
  onRestart.mockReset().mockResolvedValue(undefined);
  onHostMouseDown.mockClear(); onHostClick.mockClear(); onHostKeyDown.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function render(status: TerminalSessionStatus, leafKey = 1) {
  await act(async () => root.render(createElement("div", {
    onMouseDown: onHostMouseDown, onClick: onHostClick, onKeyDown: onHostKeyDown,
  }, createElement(TerminalSessionNotice, { key: leafKey, status, onCheck, onRestart }))));
}
function button(label: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label);
  expect(found, `Expected ${label} button`).toBeDefined(); return found!;
}
async function click(label: string) { await act(async () => button(label).click()); }

it("shows no notice for a healthy connection and never checks or restarts on render", async () => {
  await render({ state: "ready" });
  expect(container.querySelector("section")).toBeNull();
  expect(onCheck).not.toHaveBeenCalled(); expect(onRestart).not.toHaveBeenCalled();
});

it("shows a compact passive starting status without a restart shortcut", async () => {
  await render({ state: "starting" });
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Starting shell…");
  expect(container.querySelector("button")).toBeNull();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(onCheck).not.toHaveBeenCalled(); expect(onRestart).not.toHaveBeenCalled();
});

it.each(["slow-start", "exited", "disconnected", "unresponsive", "error"] as const)("offers explicit recovery for %s without taking action automatically", async (state) => {
  await render({ state, message: "Diagnostic detail" });
  expect(container.textContent).toContain("Diagnostic detail");
  expect(button("Check again").disabled).toBe(false);
  expect(button("Restart shell…").disabled).toBe(false);
  expect(onCheck).not.toHaveBeenCalled(); expect(onRestart).not.toHaveBeenCalled();
});

it("checks only when requested, keeps restart separate, and disables duplicate requests", async () => {
  let resolveCheck!: () => void;
  onCheck.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveCheck = resolve; }));
  await render({ state: "unresponsive" });
  await click("Check again");
  expect(onCheck).toHaveBeenCalledTimes(1); expect(onRestart).not.toHaveBeenCalled();
  expect(button("Checking…").disabled).toBe(true);
  expect(button("Restart shell…").disabled).toBe(true);
  await act(async () => resolveCheck());
  expect(button("Check again").disabled).toBe(false);
});

it("requires inline confirmation and warns about jobs even when the shell exited", async () => {
  await render({ state: "exited" }); await click("Restart shell…");
  expect(onRestart).not.toHaveBeenCalled();
  expect(container.querySelector('[role="group"]')?.textContent).toContain("terminates the existing shell and may stop its running jobs");
  expect(container.textContent).toContain("scrollback is kept; commands are not replayed");
  expect(document.activeElement).toBe(button("Cancel"));
  await click("Restart shell");
  expect(onRestart).toHaveBeenCalledTimes(1); expect(onCheck).not.toHaveBeenCalled();
  expect(container.querySelector('[role="group"]')).toBeNull();
});

it("lets Cancel and Escape decline restart without sending terminal keys", async () => {
  await render({ state: "disconnected" }); await click("Restart shell…"); await click("Cancel");
  expect(document.activeElement).toBe(button("Restart shell…"));
  expect(container.querySelector('[role="group"]')).toBeNull();
  await click("Restart shell…");
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  await act(async () => document.activeElement!.dispatchEvent(escape));
  expect(escape.defaultPrevented).toBe(true);
  expect(container.querySelector('[role="group"]')).toBeNull();
  expect(onRestart).not.toHaveBeenCalled(); expect(onHostKeyDown).not.toHaveBeenCalled();
});

it("does not bubble notice mouse interactions to terminal focus or cursor positioning", async () => {
  await render({ state: "unresponsive" });
  await act(async () => {
    button("Check again").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button("Check again").click();
  });
  expect(onCheck).toHaveBeenCalledTimes(1);
  expect(onHostMouseDown).not.toHaveBeenCalled(); expect(onHostClick).not.toHaveBeenCalled();
});

it("clears an obsolete restart confirmation when health recovers or the terminal changes", async () => {
  await render({ state: "unresponsive" }); await click("Restart shell…");
  await render({ state: "ready" }); expect(container.querySelector("section")).toBeNull();
  await render({ state: "error" }); expect(container.querySelector('[role="group"]')).toBeNull();
  await click("Restart shell…"); await render({ state: "error" }, 2);
  expect(container.querySelector('[role="group"]')).toBeNull(); expect(onRestart).not.toHaveBeenCalled();
});

it("renders errors as text and allows retry without restarting automatically", async () => {
  onCheck.mockRejectedValueOnce(new Error("<script>transport unavailable</script>"));
  await render({ state: "error" }); await click("Check again");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("<script>transport unavailable</script>");
  expect(container.querySelector("script")).toBeNull(); expect(onRestart).not.toHaveBeenCalled();
  await click("Check again"); expect(onCheck).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
