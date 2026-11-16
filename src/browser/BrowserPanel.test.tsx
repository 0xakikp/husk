// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  create: vi.fn(), close: vi.fn(), bounds: vi.fn(), visible: vi.fn(),
}));
vi.mock("./client", () => ({
  browserCreate: native.create,
  browserClose: native.close,
  browserSetBounds: native.bounds,
  browserSetVisible: native.visible,
  browserNavigate: vi.fn(), browserGo: vi.fn(),
  onBrowserNav: vi.fn(async () => () => {}),
  onBrowserLoad: vi.fn(async () => () => {}),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));

import { BrowserPanel } from "./BrowserPanel";

let host: HTMLDivElement;
let root: Root;
let frames: FrameRequestCallback[];
let rectWidth = 500;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  native.create.mockReset(); native.close.mockReset(); native.bounds.mockReset(); native.visible.mockReset();
  native.close.mockResolvedValue(undefined);
  native.bounds.mockResolvedValue(undefined);
  native.visible.mockResolvedValue(undefined);
  rectWidth = 500;
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    x: 10, y: 20, width: rectWidth, height: 300,
    top: 20, left: 10, right: 10 + rectWidth, bottom: 320, toJSON: () => ({}),
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function flushFrame() {
  await act(async () => { frames.shift()?.(0); await Promise.resolve(); });
}

it("closes a late native create after its panel has been removed without closing the replacement", async () => {
  let finishFirst!: () => void;
  native.create.mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }));
  native.create.mockResolvedValue(undefined);
  await act(async () => root.render(<BrowserPanel visible onClose={() => {}} />));
  await flushFrame();
  const firstLabel = native.create.mock.calls[0][0] as string;

  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => root.render(<BrowserPanel visible onClose={() => {}} />));
  await flushFrame();
  const secondLabel = native.create.mock.calls[1][0] as string;
  expect(secondLabel).not.toBe(firstLabel);

  await act(async () => { finishFirst(); await Promise.resolve(); });
  expect(native.close).toHaveBeenCalledWith(firstLabel);
  expect(native.close).not.toHaveBeenCalledWith(secondLabel);
});

it("does not schedule another animation frame every time a zero-sized panel is checked", async () => {
  rectWidth = 0;
  await act(async () => root.render(<BrowserPanel visible={false} onClose={() => {}} />));
  await flushFrame();
  expect(frames).toHaveLength(0);
  expect(native.create).not.toHaveBeenCalled();
});
