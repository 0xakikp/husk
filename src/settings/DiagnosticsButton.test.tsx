// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { DiagnosticsButton } from "./DiagnosticsButton";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); root = createRoot(container);
  vi.mocked(invoke).mockResolvedValue('{"version":"fixture"}');
  vi.mocked(writeText).mockResolvedValue();
  await act(async () => root.render(<DiagnosticsButton />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("only requests diagnostics on click and waits for clipboard success", async () => {
  expect(invoke).not.toHaveBeenCalled();
  let copied!: () => void;
  vi.mocked(writeText).mockImplementationOnce(() => new Promise<void>(resolve => { copied = resolve; }));
  await act(async () => container.querySelector("button")!.click());
  expect(invoke).toHaveBeenCalledWith("diagnostics_snapshot");
  expect(writeText).toHaveBeenCalledWith('{"version":"fixture"}');
  expect(container.querySelector("button")!.disabled).toBe(true);
  expect(container.querySelector('[role="status"]')).toBeNull();
  await act(async () => copied());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("No terminal content");
});

it("does not claim success on a failed native request or clipboard write", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("fixture"));
  await act(async () => container.querySelector("button")!.click());
  expect(writeText).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not copy");
  vi.mocked(writeText).mockRejectedValueOnce(new Error("denied"));
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not copy");
  expect(container.querySelector('[role="status"]')).toBeNull();
});
