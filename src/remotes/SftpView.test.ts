// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ deactivate: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("../fs", () => ({ getHomeDir: vi.fn().mockResolvedValue("/fixture/home") }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("../remote/sftpApi", () => ({
  sftpConnect: vi.fn(),
  sftpDisconnect: vi.fn().mockResolvedValue(undefined),
  sftpListDir: vi.fn().mockResolvedValue([]),
  sftpCopy: vi.fn(), sftpDelete: vi.fn(), sftpDeleteRecursive: vi.fn(), sftpMkdir: vi.fn(), sftpRename: vi.fn(),
}));
vi.mock("../remote/connectionStore", () => ({ markHostConnected: vi.fn(), markHostDisconnected: vi.fn() }));
vi.mock("../remote/sftpTransfers", () => ({
  activateSftpTransferQueue: vi.fn(() => fixture.deactivate),
  clearCompletedSftpTransfers: vi.fn(), enqueueSftpTransfer: vi.fn(), pauseSftpTransfer: vi.fn(),
  removeSftpTransfer: vi.fn(), resumeSftpTransfer: vi.fn(), retrySftpTransfer: vi.fn(),
  useSftpTransfers: vi.fn(() => []),
}));
import { sftpConnect, sftpDisconnect, sftpListDir } from "../remote/sftpApi";
import { activateSftpTransferQueue, enqueueSftpTransfer } from "../remote/sftpTransfers";
import { markHostDisconnected } from "../remote/connectionStore";
import { SftpView } from "./SftpView";
import { encodeSftpTarget } from "./sftpTarget";

let root: Root; let container: HTMLDivElement;
const onClose = vi.fn();
const target = { host: "prod-alias", user: "engineer", port: 2200 };
const reference = encodeSftpTarget(target);
const connected = { status: "connected" as const, hostname: "resolved.example", username: "engineer", port: 2200, fingerprint: "SHA256:fixture" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); vi.mocked(sftpConnect).mockReset(); vi.mocked(sftpConnect).mockResolvedValue(connected);
  vi.mocked(sftpListDir).mockReset(); vi.mocked(sftpListDir).mockResolvedValue([]);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(active = true) {
  await act(async () => root.render(createElement(SftpView, { host: reference, active, onClose })));
}
function button(label: string) {
  const item = [...container.querySelectorAll("button")].find(node => node.textContent?.trim() === label || node.getAttribute("aria-label") === label);
  expect(item, label).toBeDefined(); return item!;
}
async function click(label: string) { await act(async () => button(label).click()); }

it("does not connect, list directories or activate saved transfers when mounted", async () => {
  await render();
  expect(container.textContent).toContain("Browse remote files");
  expect(sftpConnect).not.toHaveBeenCalled(); expect(sftpListDir).not.toHaveBeenCalled();
  expect(activateSftpTransferQueue).not.toHaveBeenCalled(); expect(enqueueSftpTransfer).not.toHaveBeenCalled();
});

it("restoring an inactive view stays disconnected and still needs approval after activation", async () => {
  await render(false);
  expect(button("Connect & browse").disabled).toBe(true);
  expect(sftpConnect).not.toHaveBeenCalled(); expect(sftpListDir).not.toHaveBeenCalled();
  await render(true);
  expect(button("Connect & browse").disabled).toBe(false);
  expect(sftpConnect).not.toHaveBeenCalled(); expect(sftpListDir).not.toHaveBeenCalled();
  expect(activateSftpTransferQueue).not.toHaveBeenCalled();
});

it("lists only after approved connection and binds the stable queue to an opaque native session", async () => {
  await render(); await click("Connect & browse");
  const session = vi.mocked(sftpConnect).mock.calls[0][0];
  expect(session).toMatch(/^sftp-session-/); expect(session).not.toBe(reference);
  expect(sftpConnect).toHaveBeenCalledExactlyOnceWith(session, target, {}, undefined);
  expect(sftpListDir).toHaveBeenCalledExactlyOnceWith(session, ".");
  expect(activateSftpTransferQueue).toHaveBeenCalledExactlyOnceWith(reference, session);
  expect(sftpDisconnect).not.toHaveBeenCalled();
  expect(container.textContent).toContain("engineer@resolved.example:2200");
});

it("hiding a connected view deactivates its queue and returning does not reconnect automatically", async () => {
  await render(); await click("Connect & browse");
  const session = vi.mocked(sftpConnect).mock.calls[0][0];
  await render(false);
  expect(fixture.deactivate).toHaveBeenCalledOnce();
  expect(sftpDisconnect).toHaveBeenCalledWith(session);
  expect(markHostDisconnected).toHaveBeenCalledWith(reference);
  await render(true);
  expect(container.textContent).toContain("Browse remote files");
  expect(sftpConnect).toHaveBeenCalledTimes(1); expect(sftpListDir).toHaveBeenCalledTimes(1);
  expect(activateSftpTransferQueue).toHaveBeenCalledTimes(1);
  await click("Connect & browse");
  expect(sftpConnect).toHaveBeenCalledTimes(2);
  expect(activateSftpTransferQueue).toHaveBeenCalledTimes(2);
});

it("unmounting a connected view disconnects and deactivates transfers", async () => {
  await render(); await click("Connect & browse");
  const session = vi.mocked(sftpConnect).mock.calls[0][0];
  await act(async () => root.render(null));
  expect(fixture.deactivate).toHaveBeenCalledOnce();
  expect(sftpDisconnect).toHaveBeenCalledWith(session);
});

it("ignores late directory contents after hiding the view", async () => {
  let resolveList!: (value: { name: string; path: string; is_dir: boolean; size: number }[]) => void;
  vi.mocked(sftpListDir).mockImplementationOnce(() => new Promise(resolve => { resolveList = resolve; }));
  await render(); await click("Connect & browse"); await render(false);
  await act(async () => resolveList([{ name: "stale-secret-name", path: "./stale-secret-name", is_dir: false, size: 1 }]));
  await render(true);
  expect(container.textContent).not.toContain("stale-secret-name");
  expect(container.textContent).toContain("Browse remote files");
  expect(sftpConnect).toHaveBeenCalledTimes(1); expect(enqueueSftpTransfer).not.toHaveBeenCalled();
});
