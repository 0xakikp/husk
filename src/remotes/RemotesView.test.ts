// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SshConnection } from "../remote/connectionManager";

const fixture = vi.hoisted(() => ({
  connections: [] as SshConnection[],
  recent: [] as SshConnection[],
  config: "",
  preview: null as { hostname: string; username: string; port: number; authType: "auto"; reviewKey: string } | null,
  previewError: "",
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async (command: string) => command === "home_dir" ? "/fixture" : command === "read_file" ? fixture.config : undefined) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("../ai/terminalContext", () => ({ runInActiveTerminal: vi.fn(() => true), readActiveTerminalCommand: vi.fn(() => ""), getActiveRemoteTerminal: vi.fn(() => ({ isRemote: false })) }));
vi.mock("../remote/connectionStore", () => ({ useConnectedHosts: () => [] }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("./ConnectionDialog", () => ({ ConnectionDialog: vi.fn(() => null) }));
vi.mock("./PortForwardDialog", () => ({ PortForwardDialog: () => null }));
vi.mock("./useSftpTargetPreview", () => ({
  useSftpTargetPreview: (target: unknown) => ({ preview: target ? fixture.preview : null, loading: false, error: target ? fixture.previewError : "", refresh: vi.fn() }),
}));
vi.mock("../remote/connectionManager", async (importOriginal) => ({
  ...await importOriginal<typeof import("../remote/connectionManager")>(),
  useConnections: () => fixture.connections,
  getRecentConnections: () => fixture.recent,
  recordConnection: vi.fn(),
  addConnection: vi.fn((data) => ({ ...data, id: "saved", connectCount: 0 })),
  deleteConnection: vi.fn(),
  removeRecentConnection: vi.fn(() => true),
}));
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { runInActiveTerminal } from "../ai/terminalContext";
import { addConnection, recordConnection, removeRecentConnection } from "../remote/connectionManager";
import { ConnectionDialog } from "./ConnectionDialog";
import { RemotesView } from "./RemotesView";
import { decodeSftpTarget } from "./sftpTarget";

const profile = (extra: Partial<SshConnection> = {}): SshConnection => ({
  id: "home", name: "Home server", host: "houseofaki", user: "", port: 22,
  authType: "agent", tags: ["ssh-config"], connectCount: 0, ...extra,
});
let root: Root;
let container: HTMLDivElement;
const onSftp = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.connections = []; fixture.recent = []; fixture.config = ""; fixture.preview = null; fixture.previewError = "";
  vi.clearAllMocks(); onSftp.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  Element.prototype.scrollIntoView ??= vi.fn();
  HTMLElement.prototype.hasPointerCapture ??= () => false;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(createElement(RemotesView, { inline: true, onSftp }))); }
async function clickLabel(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.title === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
function connectionRow(section: "recent" | "saved") {
  const row = container.querySelector<HTMLElement>(`.remote-connection-row[data-section="${section}"]`);
  expect(row, `${section} connection row`).not.toBeNull();
  return row!;
}
function connectionDescription(section: "recent" | "saved") {
  const row = connectionRow(section);
  const connect = row.matches("button") ? row : row.querySelector<HTMLButtonElement>(".remote-connection-trigger");
  const descriptionId = connect?.getAttribute("aria-describedby");
  expect(descriptionId, `${section} connect description ID`).toBeTruthy();
  const description = document.getElementById(descriptionId!);
  expect(description, `${section} connect description`).not.toBeNull();
  expect(row.contains(description)).toBe(true);
  expect(description?.classList.contains("sr-only")).toBe(true);
  return description!;
}
async function openContextMenu(element: HTMLElement) {
  await act(async () => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })));
}
async function clickMenuItem(label: string) {
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent?.trim() === label);
  expect(item, label).toBeDefined();
  await act(async () => item!.click());
}

it("imports an alias with explicit inheritance without attempting a connection", async () => {
  fixture.config = "Host houseofaki\n  HostName home.example\n  User owner\n  Port 1243\n";
  await render();
  const expand = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("From ~/.ssh/config"));
  expect(expand).toBeDefined(); await act(async () => expand!.click());
  await clickLabel("Import to Saved"); await clickLabel("Import");
  expect(addConnection).toHaveBeenCalledExactlyOnceWith({ name: "houseofaki", host: "houseofaki", port: 22, user: "", authType: "agent", inheritSshConfig: true, tags: ["ssh-config"] });
  expect(runInActiveTerminal).not.toHaveBeenCalled(); expect(onSftp).not.toHaveBeenCalled();
  expect(vi.mocked(invoke).mock.calls.every(([command]) => command === "home_dir" || command === "read_file")).toBe(true);
});

it("shows inherited values instead of dummy defaults and keeps SSH/SFTP alias targeting aligned", async () => {
  fixture.connections = [profile()];
  fixture.preview = { hostname: "home.example", username: "owner", port: 1243, authType: "auto", reviewKey: "fixture" };
  await render();
  expect(container.querySelector(".remote-connection-address")?.textContent).toBe("owner@home.example:1243");
  expect(container.querySelector(".remote-connection-source")?.textContent).toBe("SSH config");
  expect(connectionDescription("saved").textContent).toBe("owner@home.example:1243\nSSH config · Alias: houseofaki");
  expect(container.textContent).not.toContain("@houseofaki:22");
  const connect = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Home server"));
  expect(connect).toBeDefined(); await act(async () => connect!.click());
  expect(runInActiveTerminal).toHaveBeenCalledWith("ssh 'houseofaki'");
  await clickLabel("Open SFTP");
  expect(decodeSftpTarget(onSftp.mock.calls[0][0])).toEqual({ host: "houseofaki" });
});

it("does not claim port 22 while inherited settings are unresolved or unavailable", async () => {
  fixture.connections = [profile()]; fixture.recent = fixture.connections; await render();
  for (const section of ["recent", "saved"] as const) {
    expect(connectionRow(section).querySelector(".remote-connection-address")?.textContent).toBe("houseofaki");
    expect(connectionRow(section).querySelector(".remote-connection-source")?.textContent).toBe("SSH config");
    expect(connectionDescription(section).textContent).toBe("houseofaki\nSSH config · Alias: houseofaki");
  }
  expect(container.textContent).not.toContain(":22");
  fixture.previewError = "Unsupported SSH config policy"; await render();
  for (const section of ["recent", "saved"] as const) {
    const row = connectionRow(section);
    expect(row.querySelector(".remote-connection-address")?.textContent).toBe("houseofaki");
    expect(row.querySelector('[aria-label="Preview unavailable"]')).not.toBeNull();
    expect(row.querySelector(".remote-connection-address")?.getAttribute("title")).toContain("Unsupported SSH config policy");
    expect(connectionDescription(section).textContent).toBe("houseofaki\nSSH config · Alias: houseofaki\nPreview unavailable: Unsupported SSH config policy");
  }
  expect(container.textContent).not.toContain(":22");
});

it("preserves an explicit manual port 22 for terminal and SFTP connections", async () => {
  fixture.connections = [profile({ inheritSshConfig: false, user: "owner" })]; await render();
  expect(container.textContent).toContain("owner@houseofaki:22");
  const connect = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Home server"));
  await act(async () => connect!.click());
  expect(runInActiveTerminal).toHaveBeenCalledWith("ssh -p 22 'owner@houseofaki'");
  await clickLabel("Open SFTP");
  expect(decodeSftpTarget(onSftp.mock.calls[0][0])).toEqual({ host: "houseofaki", user: "owner", port: 22, authType: "agent" });
});

it.each([true, false])("preserves inheritance=%s when duplicating a profile", async (inheritSshConfig) => {
  fixture.connections = [profile({ inheritSshConfig })]; await render();
  const connect = [...container.querySelectorAll("button")].find((node) => node.textContent?.includes("Home server"));
  await act(async () => connect!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 50, clientY: 50 })));
  const duplicate = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent?.trim() === "Duplicate");
  expect(duplicate).toBeDefined(); await act(async () => duplicate!.click());
  expect(addConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "Home server copy", inheritSshConfig }));
  expect(runInActiveTerminal).not.toHaveBeenCalled(); expect(onSftp).not.toHaveBeenCalled();
});

it("uses matching name-first summaries for full-width Recent and Saved rows without connecting", async () => {
  const connection = profile({ name: "Production application server with a long descriptive name" });
  fixture.connections = [connection]; fixture.recent = [connection];
  fixture.preview = { hostname: "application.production.internal.example.com", username: "deployment-service", port: 1243, authType: "auto", reviewKey: "fixture" };
  await render();
  expect(container.querySelectorAll(".remote-connection-list").length).toBeGreaterThanOrEqual(1);
  expect(connectionRow("recent").closest(".remote-connection-list")).not.toBeNull();
  const descriptionIds = new Set<string>();
  for (const section of ["recent", "saved"] as const) {
    const row = connectionRow(section);
    const summary = row.querySelector(".remote-connection-summary");
    const heading = summary?.querySelector(".remote-connection-heading");
    const name = heading?.querySelector(".remote-connection-name");
    const source = heading?.querySelector(".remote-connection-source");
    const address = summary?.querySelector(".remote-connection-address");
    expect(name?.textContent).toBe(connection.name);
    expect(name?.getAttribute("title")).toBe(connection.name);
    expect(source?.textContent).toBe("SSH config");
    expect(address?.parentElement).toBe(summary);
    expect(heading?.contains(address!)).toBe(false);
    expect(address?.textContent).toBe("deployment-service@application.production.internal.example.com:1243");
    expect(address?.getAttribute("title")).toContain("deployment-service@application.production.internal.example.com:1243");
    expect(address?.getAttribute("title")).toContain("Alias: houseofaki");
    expect(address?.textContent).not.toContain("SSH config");
    const description = connectionDescription(section);
    expect(description.textContent).toBe("deployment-service@application.production.internal.example.com:1243\nSSH config · Alias: houseofaki");
    descriptionIds.add(description.id);
  }
  expect(descriptionIds.size).toBe(2);
  const saved = connectionRow("saved");
  const actions = saved.querySelector(".remote-connection-actions");
  expect(actions).not.toBeNull();
  expect(saved.querySelector(".remote-connection-summary")?.contains(actions)).toBe(false);
  expect(runInActiveTerminal).not.toHaveBeenCalled();
  expect(onSftp).not.toHaveBeenCalled();
  expect(recordConnection).not.toHaveBeenCalled();
});

it("shows long manual endpoints with complete jump-host details in both row tooltips", async () => {
  const connection = profile({
    name: "Long manual connection name that must remain available in its tooltip",
    host: "database.production.internal.example.com", user: "database-administrator", port: 2222,
    jumpHost: "bastion.production.internal.example.com", inheritSshConfig: false,
  });
  fixture.connections = [connection]; fixture.recent = [connection];
  await render();
  const endpoint = "database-administrator@database.production.internal.example.com:2222";
  for (const section of ["recent", "saved"] as const) {
    const row = connectionRow(section);
    const address = row.querySelector(".remote-connection-address");
    expect(row.querySelector(".remote-connection-name")?.getAttribute("title")).toBe(connection.name);
    expect(row.querySelector(".remote-connection-source")).toBeNull();
    expect(address?.textContent).toBe(endpoint);
    expect(address?.getAttribute("title")).toBe(`${endpoint}\nVia bastion.production.internal.example.com`);
    expect(connectionDescription(section).textContent).toBe(`${endpoint}\nVia bastion.production.internal.example.com`);
  }
});

it("connects an inherited Recent row through its SSH alias when clicked", async () => {
  fixture.connections = [profile()]; fixture.recent = fixture.connections;
  await render();
  await act(async () => connectionRow("recent").click());
  expect(runInActiveTerminal).toHaveBeenCalledExactlyOnceWith("ssh 'houseofaki'");
  expect(recordConnection).toHaveBeenCalledExactlyOnceWith("home");
  expect(onSftp).not.toHaveBeenCalled();
});

it.each([
  "Connect in active terminal", "Open SFTP", "Edit connection…", "Copy SSH command", "Copy address", "Remove from Recent",
])("preserves the Recent context-menu action: %s", async (action) => {
  fixture.connections = [profile()]; fixture.recent = fixture.connections;
  await render();
  await openContextMenu(connectionRow("recent"));
  expect(runInActiveTerminal).not.toHaveBeenCalled();
  await clickMenuItem(action);
  if (action === "Connect in active terminal") {
    expect(runInActiveTerminal).toHaveBeenCalledExactlyOnceWith("ssh 'houseofaki'");
    expect(recordConnection).toHaveBeenCalledExactlyOnceWith("home");
  } else {
    expect(runInActiveTerminal).not.toHaveBeenCalled();
    expect(recordConnection).not.toHaveBeenCalled();
  }
  if (action === "Open SFTP") {
    expect(onSftp).toHaveBeenCalledOnce();
    expect(decodeSftpTarget(onSftp.mock.calls[0][0])).toEqual({ host: "houseofaki" });
  } else expect(onSftp).not.toHaveBeenCalled();
  if (action === "Edit connection…") expect(ConnectionDialog).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "home" }), undefined);
  if (action === "Copy SSH command") expect(writeText).toHaveBeenCalledExactlyOnceWith("ssh 'houseofaki'");
  if (action === "Copy address") expect(writeText).toHaveBeenCalledExactlyOnceWith("houseofaki");
  if (action === "Remove from Recent") expect(removeRecentConnection).toHaveBeenCalledExactlyOnceWith("home");
});

it("keeps Saved SFTP and edit actions independent from the connect button", async () => {
  fixture.connections = [profile()]; await render();
  const row = connectionRow("saved");
  const actions = row.querySelector(".remote-connection-actions");
  const sftp = actions?.querySelector<HTMLButtonElement>('button[title="Open SFTP"]');
  const edit = actions?.querySelector<HTMLButtonElement>('button[title="Edit"]');
  expect(sftp).toBeDefined(); expect(edit).toBeDefined();
  await act(async () => { sftp!.focus(); sftp!.click(); });
  expect(decodeSftpTarget(onSftp.mock.calls[0][0])).toEqual({ host: "houseofaki" });
  await act(async () => { edit!.focus(); edit!.click(); });
  expect(ConnectionDialog).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "home" }), undefined);
  expect(runInActiveTerminal).not.toHaveBeenCalled();
  expect(recordConnection).not.toHaveBeenCalled();
});
