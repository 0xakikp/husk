// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PortForward } from "../remote/connectionManager";

const fixture = vi.hoisted(() => ({
  forwards: [] as PortForward[],
  invoke: vi.fn(),
  events: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("../remote/connectionManager", () => ({
  getPortForwards: (connectionId: string) => fixture.forwards.filter((forward) => forward.connectionId === connectionId),
  getConnectionById: () => ({ host: "example.test", port: 22, user: "test", authType: "agent" }),
  addPortForward: vi.fn(),
  updatePortForward: (id: string, updates: Partial<PortForward>) => {
    const index = fixture.forwards.findIndex((forward) => forward.id === id);
    if (index < 0) return null;
    fixture.forwards[index] = { ...fixture.forwards[index], ...updates };
    fixture.events.push(`update:${id}:${fixture.forwards[index].active}`);
    return fixture.forwards[index];
  },
  deletePortForward: (id: string) => {
    fixture.events.push(`delete:${id}`);
    fixture.forwards = fixture.forwards.filter((forward) => forward.id !== id);
    return true;
  },
}));
vi.mock("../components/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../components/ui/switch", () => ({
  Switch: ({ checked, disabled, onCheckedChange, ...props }: {
    checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void;
  }) => <button role="switch" aria-checked={checked} disabled={disabled} onClick={() => onCheckedChange(!checked)} {...props} />,
}));
vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("../toast", () => ({ toast: vi.fn() }));

import { PortForwardDialog, reconcileForwardActivity } from "./PortForwardDialog";

const forward: PortForward = {
  id: "forward-1", connectionId: "connection-1", type: "local", localPort: 8080,
  remoteHost: "localhost", remotePort: 80, active: false,
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.forwards = [{ ...forward }];
  fixture.events = [];
  fixture.invoke.mockReset();
  fixture.invoke.mockImplementation(async (command: string) => {
    fixture.events.push(`invoke:${command}`);
    return command === "port_forward_list" ? [] : undefined;
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("treats saved running flags as stale unless the native process reports them", async () => {
  fixture.forwards[0].active = true;
  await act(async () => root.render(<PortForwardDialog connectionId="connection-1" onClose={() => {}} />));
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  expect(fixture.forwards[0].active).toBe(false);
  expect(fixture.events).toContain("update:forward-1:false");
});

it("stops a running tunnel before deleting its saved configuration", async () => {
  fixture.invoke.mockImplementation(async (command: string) => {
    fixture.events.push(`invoke:${command}`);
    return command === "port_forward_list" ? [{ id: "forward-1", active: true, error: null }] : undefined;
  });
  await act(async () => root.render(<PortForwardDialog connectionId="connection-1" onClose={() => {}} />));
  expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
  const remove = host.querySelector<HTMLButtonElement>('[aria-label^="Remove localhost"]')!;
  await act(async () => remove.click());
  expect(fixture.events.indexOf("invoke:port_forward_stop")).toBeLessThan(fixture.events.indexOf("delete:forward-1"));
  expect(fixture.forwards).toHaveLength(0);
});

it("shows unknown rather than a stale running switch when native status cannot be checked", async () => {
  fixture.forwards[0].active = true;
  fixture.invoke.mockRejectedValue(new Error("native unavailable"));
  await act(async () => root.render(<PortForwardDialog connectionId="connection-1" onClose={() => {}} />));
  expect(host.textContent).toContain("Could not verify running tunnels");
  expect(host.textContent).toContain("Unknown");
  expect(host.querySelector('[role="switch"]')).toBeNull();
  expect(host.querySelector<HTMLButtonElement>('[aria-label^="Remove localhost"]')?.disabled).toBe(true);
});

it("does not overwrite a user action while its native command is pending", () => {
  const result = reconcileForwardActivity([{ ...forward, active: true }], [], new Set([forward.id]));
  expect(result[0].active).toBe(true);
});
