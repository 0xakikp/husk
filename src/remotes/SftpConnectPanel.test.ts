// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../remote/sftpApi", () => ({ sftpConnect: vi.fn(), sftpDisconnect: vi.fn().mockResolvedValue(undefined) }));
import { sftpConnect, sftpDisconnect, type SftpConnectionResult } from "../remote/sftpApi";
import { SftpConnectPanel } from "./SftpConnectPanel";
import { encodeSftpTarget } from "./sftpTarget";

let root: Root;
let container: HTMLDivElement;
const onConnected = vi.fn();
const onClose = vi.fn();
const target = { host: "prod-alias", user: "engineer", port: 2200, authType: "password" as const };
const identity: SftpConnectionResult = { status: "verify-host", hostname: "resolved.example", username: "engineer", port: 2200, fingerprint: "SHA256:fixture-server-key" };
const connected: SftpConnectionResult = { ...identity, status: "connected" };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(sftpConnect).mockReset(); vi.mocked(sftpDisconnect).mockClear(); onConnected.mockReset(); onClose.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(active = true, reference = encodeSftpTarget(target)) {
  await act(async () => root.render(createElement(SftpConnectPanel, { reference, sessionKey: "session-fixture", active, onConnected, onClose })));
}
function button(label: string) {
  const item = [...container.querySelectorAll("button")].find(node => node.textContent?.trim() === label);
  expect(item, label).toBeDefined(); return item!;
}
async function click(label: string) { await act(async () => button(label).click()); }
function password() { return container.querySelector<HTMLInputElement>('input[type="password"]')!; }
async function enterSecret(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(password(), value);
    password().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows an honest connection preview without connecting on mount", async () => {
  await render();
  expect(container.textContent).toContain("engineer@prod-alias:2200");
  expect(container.textContent).toContain("does not reuse your terminal login");
  expect(container.textContent).toContain("No automatic uploads, sync or AI sharing");
  expect(password().type).toBe("password"); expect(password().autocomplete).toBe("off");
  expect(sftpConnect).not.toHaveBeenCalled(); expect(onConnected).not.toHaveBeenCalled();
  expect(container.querySelector(".compact-form")).not.toBeNull();
});

it("requires explicit independent fingerprint verification before authentication retry", async () => {
  vi.mocked(sftpConnect).mockResolvedValueOnce(identity).mockResolvedValueOnce(connected);
  await render(); await enterSecret("transient-password"); await click("Connect & browse");
  expect(sftpConnect).toHaveBeenNthCalledWith(1, "session-fixture", target, { password: "transient-password" }, undefined);
  expect(container.textContent).toContain("engineer@resolved.example:2200");
  expect(container.textContent).toContain(identity.fingerprint);
  expect(button("Trust verified key & connect").disabled).toBe(true);
  await click("Trust verified key & connect"); expect(sftpConnect).toHaveBeenCalledTimes(1);
  expect(onConnected).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Trust verified key & connect");
  expect(sftpConnect).toHaveBeenNthCalledWith(2, "session-fixture", target, { password: "transient-password" }, identity.fingerprint);
  expect(onConnected).toHaveBeenCalledExactlyOnceWith(connected);
  expect(password().value).toBe("");
  await act(async () => root.render(null));
  expect(sftpDisconnect).not.toHaveBeenCalled(); // ownership passes to the connected browser
});

it("clears transient credentials after an authentication failure", async () => {
  vi.mocked(sftpConnect).mockRejectedValueOnce(new Error("Authentication refused"));
  await render(); await enterSecret("never-persist-this"); await click("Connect & browse");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Authentication refused");
  expect(password().value).toBe(""); expect(onConnected).not.toHaveBeenCalled();
});

it("requires a fresh connection attempt after a verification challenge fails", async () => {
  vi.mocked(sftpConnect).mockResolvedValueOnce(identity).mockRejectedValueOnce(new Error("The SFTP target changed"));
  await render(); await enterSecret("temporary"); await click("Connect & browse");
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Trust verified key & connect");
  expect(container.querySelector('[aria-label="Verify server identity"]')).toBeNull();
  expect(button("Connect & browse").disabled).toBe(false);
  expect(password().value).toBe("");
  expect(onConnected).not.toHaveBeenCalled();
  vi.mocked(sftpConnect).mockResolvedValueOnce(identity);
  await click("Connect & browse");
  expect(sftpConnect).toHaveBeenLastCalledWith("session-fixture", target, {}, undefined);
  expect(button("Trust verified key & connect").disabled).toBe(true);
});

it("disables hidden connection actions and clears in-memory credentials", async () => {
  await render(); await enterSecret("temporary"); await render(false);
  expect(password().value).toBe(""); expect(button("Connect & browse").disabled).toBe(true);
  await click("Connect & browse"); expect(sftpConnect).not.toHaveBeenCalled();
});

it("ignores and disconnects a result that arrives after the panel becomes inactive", async () => {
  let resolve!: (result: SftpConnectionResult) => void;
  vi.mocked(sftpConnect).mockImplementationOnce(() => new Promise(result => { resolve = result; }));
  await render(); await click("Connect & browse"); await render(false);
  await act(async () => resolve(connected));
  expect(onConnected).not.toHaveBeenCalled();
  expect(sftpDisconnect).toHaveBeenCalledWith("session-fixture");
});

it("does not let an old result disconnect a newer connection after hide and reopen", async () => {
  let resolveOld!: (result: SftpConnectionResult) => void;
  let resolveNew!: (result: SftpConnectionResult) => void;
  vi.mocked(sftpConnect)
    .mockImplementationOnce(() => new Promise(result => { resolveOld = result; }))
    .mockImplementationOnce(() => new Promise(result => { resolveNew = result; }));
  await render(); await click("Connect & browse"); await render(false);
  expect(sftpDisconnect).toHaveBeenCalledExactlyOnceWith("session-fixture");
  await render(true); await click("Connect & browse");
  const disconnectsBeforeOldResult = vi.mocked(sftpDisconnect).mock.calls.length;
  await act(async () => resolveOld(connected));
  expect(sftpDisconnect).toHaveBeenCalledTimes(disconnectsBeforeOldResult);
  expect(onConnected).not.toHaveBeenCalled();
  expect(button("Connecting…").disabled).toBe(true);
  await act(async () => resolveNew(connected));
  expect(onConnected).toHaveBeenCalledExactlyOnceWith(connected);
  expect(sftpDisconnect).toHaveBeenCalledTimes(disconnectsBeforeOldResult);
});

it("cancels a pending connection without accepting a late success", async () => {
  let resolve!: (result: SftpConnectionResult) => void;
  vi.mocked(sftpConnect).mockImplementationOnce(() => new Promise(result => { resolve = result; }));
  await render(); await click("Connect & browse"); await click("Cancel");
  expect(onClose).toHaveBeenCalledOnce(); expect(sftpDisconnect).toHaveBeenCalledWith("session-fixture");
  await act(async () => resolve(connected)); expect(onConnected).not.toHaveBeenCalled();
});

it("does not bypass a configured jump host", async () => {
  await render(true, encodeSftpTarget({ ...target, jumpHost: "bastion.example" }));
  expect(container.textContent).toContain("Husk will not bypass it");
  expect(button("Connect & browse").disabled).toBe(true);
  await click("Connect & browse"); expect(sftpConnect).not.toHaveBeenCalled();
});

it("rejects invalid saved targets without invoking native connection code", async () => {
  await render(true, "husk-sftp:not-json");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid");
  expect(sftpConnect).not.toHaveBeenCalled(); await click("Close"); expect(onClose).toHaveBeenCalledOnce();
});
