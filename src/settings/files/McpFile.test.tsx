// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpServerForm } from "./McpFile";
import type { McpServerConfig } from "../../mcp/store";

vi.mock("@/mcp/client", () => ({ disconnectMcpServer: vi.fn() }));
vi.mock("@/mcp/health", () => ({ getMcpHealth: vi.fn(), testMcpConnection: vi.fn(), useMcpHealth: vi.fn() }));
vi.mock("@/mcp/store", () => ({ addMcpServer: vi.fn(), loadMcpServers: vi.fn(), removeMcpServer: vi.fn(), updateMcpServer: vi.fn() }));
vi.mock("@/secrets", () => ({ secretsDelete: vi.fn(), secretsGet: vi.fn(), secretsSet: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
const onSave = vi.fn();
const server: McpServerConfig = { id: "fixture", name: "Fixture", command: "fixture-command", args: ["--folder", "/My Project", 'literal "quotes"', "", "line\nbreak"], env: { LOG_LEVEL: "debug" }, secretEnv: { API_TOKEN: "fixture-keychain-reference" }, enabled: false };
beforeEach(async () => {
  vi.clearAllMocks(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onSave.mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<McpServerForm editing={server} onCancel={() => {}} onSave={onSave} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function change(label: string, value: string) {
  const element = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() { await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

describe("MCP server argument preservation", () => {
  it("keeps exact arguments and keychain references after editing only a name", async () => {
    await change("Server name", "Renamed fixture");
    await submit();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "Renamed fixture", args: server.args, secretEnv: server.secretEnv, enabled: false }));
  });
  it("blocks malformed JSON instead of splitting paths or silently saving", async () => {
    await change("Server arguments (JSON array)", '--folder "/My Project"');
    await submit();
    expect(onSave).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("JSON array");
  });
  it("reports save errors and preserves the entered arguments", async () => {
    onSave.mockRejectedValueOnce(new Error("Keychain unavailable"));
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Keychain unavailable");
    expect(JSON.parse((container.querySelector('[aria-label="Server arguments (JSON array)"]') as HTMLTextAreaElement).value)).toEqual(server.args);
  });
});
