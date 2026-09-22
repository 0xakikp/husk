// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SshConnection } from "../remote/connectionManager";

const fixture = vi.hoisted(() => ({ existing: undefined as SshConnection | undefined }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../remote/connectionManager", () => ({
  getConnectionById: () => fixture.existing,
  addConnection: vi.fn((data) => ({ ...data, id: "new", connectCount: 0 })),
  updateConnection: vi.fn((id, data) => ({ ...data, id, connectCount: 1 })),
  deleteConnection: vi.fn(),
}));
import { invoke } from "@tauri-apps/api/core";
import { addConnection, updateConnection, deleteConnection } from "../remote/connectionManager";
import { ConnectionDialog } from "./ConnectionDialog";
import { SidebarSheetContext, SHEET_HOST_ID } from "../components/sheetHost";

let root: Root; let container: HTMLDivElement;
const onClose = vi.fn(); const onSave = vi.fn();
const confirmDelete = vi.fn();
const existing = (extra: Partial<SshConnection> = {}): SshConnection => ({ id: "existing", name: "Test host", host: "host.example", port: 22, user: "dev", authType: "agent", tags: ["dev"], connectCount: 1, ...extra });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.existing = undefined;
  onClose.mockReset(); onSave.mockReset(); vi.mocked(invoke).mockReset();
  confirmDelete.mockReset(); vi.stubGlobal("confirm", confirmDelete);
  vi.mocked(addConnection).mockClear(); vi.mocked(updateConnection).mockClear(); vi.mocked(deleteConnection).mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  Element.prototype.scrollIntoView ??= vi.fn();
  HTMLElement.prototype.hasPointerCapture ??= () => false;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(ConnectionDialog, { connectionId: fixture.existing?.id, onSave, onClose }))); }
function input(id: string) { const field = document.getElementById(id) as HTMLInputElement; expect(field, id).not.toBeNull(); return field; }
async function enter(id: string, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(id), value); input(id).dispatchEvent(new Event("input", { bubbles: true })); }); }
function button(label: string) { const node = [...document.querySelectorAll("button")].find((item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label); expect(node, label).toBeDefined(); return node!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function authentication(label: string) {
  const trigger = document.getElementById("conn-auth")!;
  await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent === label);
  expect(option, label).toBeDefined(); await act(async () => { option!.click(); });
}

it("opens with compact themed primitives and no native activity", async () => {
  await render();
  expect(document.querySelector(".compact-form")).not.toBeNull();
  expect(document.querySelector('[role="dialog"].compact-panel.compact-dialog > .compact-body')).not.toBeNull();
  expect(input("conn-name").className).toContain("compact-control");
  expect(button("Save").className).toContain("compact-button");
  expect(document.querySelector('label[for="conn-name"]')).not.toBeNull();
  expect(document.querySelector('label[for="conn-auth"]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("New SSH Connection");
  expect(document.querySelector('[role="dialog"]')?.className).not.toMatch(/(?:text|bg|border|ring)-(?:slate|white|black)/);
  expect(invoke).not.toHaveBeenCalled(); expect(addConnection).not.toHaveBeenCalled(); expect(updateConnection).not.toHaveBeenCalled();
});

it("uses the same compact panel and body when opened inside the sidebar", async () => {
  const host = document.createElement("div"); host.id = SHEET_HOST_ID; document.body.append(host);
  await act(async () => root.render(createElement(SidebarSheetContext.Provider, { value: true },
    createElement(ConnectionDialog, { onSave, onClose }),
  )));
  expect(host.querySelector('.sidebar-sheet-panel.compact-panel > .compact-body')).not.toBeNull();
  expect(input("conn-name").classList.contains("compact-control")).toBe(true);
  expect(button("Save").dataset.compactSize).toBe("normal");
  expect(invoke).not.toHaveBeenCalled(); expect(addConnection).not.toHaveBeenCalled();
  await act(async () => root.render(null)); host.remove();
});

it("associates validation errors with required fields without saving or connecting", async () => {
  await render(); await enter("conn-port", "0"); await click("Save");
  for (const field of ["name", "host", "user", "port"]) {
    const node = input("conn-" + field);
    expect(node.getAttribute("aria-invalid")).toBe("true");
    expect(node.getAttribute("aria-describedby")).toBe("conn-" + field + "-error");
    expect(document.getElementById("conn-" + field + "-error")?.getAttribute("role")).toBe("alert");
  }
  expect(onSave).not.toHaveBeenCalled(); expect(addConnection).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
});

it("preserves normalized save values and accessible color choices", async () => {
  await render(); await enter("conn-name", " Production "); await enter("conn-host", " host.example ");
  await enter("conn-user", " dev "); await enter("conn-port", "2222"); await enter("conn-tags", " prod, aws, , ");
  await enter("conn-jump", " bastion.example "); await click("Color #3b82f6");
  expect(button("Color #3b82f6").getAttribute("aria-pressed")).toBe("true"); expect(button("No color").getAttribute("aria-pressed")).toBe("false");
  await click("Save");
  expect(addConnection).toHaveBeenCalledExactlyOnceWith({ name: "Production", host: "host.example", port: 2222, user: "dev", authType: "agent", password: undefined, privateKeyPath: undefined, passphrase: undefined, jumpHost: "bastion.example", tags: ["prod", "aws"], color: "#3b82f6" });
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: "new" })); expect(invoke).not.toHaveBeenCalled();
});

it("switches auth fields and opens the native key picker only on explicit click", async () => {
  fixture.existing = existing(); await render();
  expect(document.getElementById("conn-password")).toBeNull(); expect(document.getElementById("conn-key")).toBeNull();
  await authentication("Private Key"); await click("Save");
  expect(input("conn-key").getAttribute("aria-invalid")).toBe("true"); expect(invoke).not.toHaveBeenCalled();
  vi.mocked(invoke).mockResolvedValueOnce("/keys/id_ed25519"); await click("Choose private key file");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pick_file", { filters: [{ name: "SSH Key", extensions: ["", "pem", "key"] }] });
  expect(input("conn-key").value).toBe("/keys/id_ed25519"); expect(input("conn-passphrase").type).toBe("password");
  await authentication("Password"); expect(document.getElementById("conn-key")).toBeNull(); expect(input("conn-password").type).toBe("password");
});

it("keeps edit and confirmed deletion behavior", async () => {
  fixture.existing = existing({ authType: "password", password: "saved-password" }); await render();
  expect(input("conn-password").value).toBe("saved-password"); await enter("conn-name", "Updated"); await click("Save");
  expect(updateConnection).toHaveBeenCalledWith("existing", expect.objectContaining({ name: "Updated", authType: "password", password: "saved-password" }));
  expect(addConnection).not.toHaveBeenCalled();
  confirmDelete.mockReturnValueOnce(false).mockReturnValueOnce(true);
  await click("Delete"); expect(deleteConnection).not.toHaveBeenCalled(); expect(onClose).not.toHaveBeenCalled();
  await click("Delete"); expect(deleteConnection).toHaveBeenCalledExactlyOnceWith("existing"); expect(onClose).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});

it("preserves the chosen private key when file selection is cancelled", async () => {
  fixture.existing = existing({ authType: "key", privateKeyPath: "/keys/existing", passphrase: "key-passphrase" }); await render();
  expect(invoke).not.toHaveBeenCalled(); vi.mocked(invoke).mockRejectedValueOnce(new Error("cancelled"));
  await click("Choose private key file"); expect(input("conn-key").value).toBe("/keys/existing");
  await click("Save"); expect(updateConnection).toHaveBeenCalledWith("existing", expect.objectContaining({ privateKeyPath: "/keys/existing", passphrase: "key-passphrase", authType: "key" }));
});

it("cancel closes without saving or connecting", async () => {
  await render(); await enter("conn-name", "Unsaved"); await click("Cancel");
  expect(onClose).toHaveBeenCalledOnce(); expect(addConnection).not.toHaveBeenCalled(); expect(onSave).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
});
