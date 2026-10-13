// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../remote/sftpApi", () => ({ sftpPreviewTarget: vi.fn() }));
import { sftpPreviewTarget, type SftpTargetPreview } from "../remote/sftpApi";
import type { SftpTarget } from "./sftpTarget";
import { useSftpTargetPreview } from "./useSftpTargetPreview";

const preview: SftpTargetPreview = { hostname: "home.example", port: 1243, username: "owner", authType: "auto", reviewKey: "fixture" };
let root: Root;
let container: HTMLDivElement;
let state: ReturnType<typeof useSftpTargetPreview>;
function Fixture({ target, active }: { target: SftpTarget | null; active: boolean }) {
  state = useSftpTargetPreview(target, active);
  return null;
}
async function render(target: SftpTarget | null = { host: "home" }, active = true) {
  await act(async () => root.render(createElement(Fixture, { target, active })));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(sftpPreviewTarget).mockReset().mockResolvedValue(preview);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("resolves public metadata once for equivalent target values", async () => {
  await render(); await render({ host: "home" });
  expect(sftpPreviewTarget).toHaveBeenCalledExactlyOnceWith({ host: "home" });
  expect(state.preview).toEqual(preview); expect(state.loading).toBe(false); expect(state.error).toBe("");
});

it("never previews invalid or inactive targets and hides previous metadata", async () => {
  await render(null); await render({ host: "home" }, false);
  expect(sftpPreviewTarget).not.toHaveBeenCalled(); expect(state.preview).toBeNull(); expect(state.loading).toBe(false);
  await render(); expect(state.preview).toEqual(preview);
  await render(null); expect(state.preview).toBeNull();
});

it("does not apply a late response to another target", async () => {
  let resolveOld!: (value: SftpTargetPreview) => void;
  vi.mocked(sftpPreviewTarget).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await render(); expect(state.loading).toBe(true);
  const next = { ...preview, hostname: "next.example", reviewKey: "next" };
  vi.mocked(sftpPreviewTarget).mockResolvedValue(next);
  await render({ host: "next" });
  await act(async () => resolveOld(preview));
  expect(state.preview).toEqual(next); expect(state.error).toBe("");
});

it("reports local config failures without retaining the old preview", async () => {
  await render();
  vi.mocked(sftpPreviewTarget).mockRejectedValue("Unsupported policy");
  await render({ host: "other" });
  expect(state.preview).toBeNull(); expect(state.loading).toBe(false); expect(state.error).toBe("Unsupported policy");
});

it("refresh invalidates the reviewed destination immediately and uses new metadata", async () => {
  await render();
  let resolveNew!: (value: SftpTargetPreview) => void;
  vi.mocked(sftpPreviewTarget).mockImplementationOnce(() => new Promise(resolve => { resolveNew = resolve; }));
  await act(async () => state.refresh());
  expect(state.preview).toBeNull(); expect(state.loading).toBe(true);
  const next = { ...preview, port: 2222, reviewKey: "new" };
  await act(async () => resolveNew(next));
  expect(state.preview).toEqual(next); expect(sftpPreviewTarget).toHaveBeenCalledTimes(2);
});

it("does not apply late responses after hiding and fetches again when reopened", async () => {
  let resolveOld!: (value: SftpTargetPreview) => void;
  vi.mocked(sftpPreviewTarget).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  await render(); await render({ host: "home" }, false);
  await act(async () => resolveOld(preview)); expect(state.preview).toBeNull();
  await render(); expect(sftpPreviewTarget).toHaveBeenCalledTimes(2); expect(state.preview).toEqual(preview);
});
