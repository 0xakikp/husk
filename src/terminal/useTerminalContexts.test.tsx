// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ capture: vi.fn(), invoke: vi.fn() }));
vi.mock("./registry", () => ({ getTerminalContextSnapshot: fixture.capture }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
import { parseTerminalContexts, useTerminalContexts } from "./useTerminalContexts";
import type { TerminalContextSnapshot } from "./contextCapture";
import type { TerminalStatusSnapshot } from "./statusBarState";

const config = {
  kubernetes: { context: "staging", namespace: "payments", source: "config" },
  docker: { context: "orbstack", source: "config" }, kubernetesReason: null, dockerReason: null,
};
const both = { kubernetes: true, docker: true };
const local = (patch: Partial<TerminalStatusSnapshot> = {}): TerminalStatusSnapshot => ({
  leafId: 1, scopeKey: "one:1", scope: "local", host: null, cwd: "/work", atPrompt: true,
  promptRevision: 1, command: "", startedAt: null, lastRun: null, ...patch,
});
const metadata = (patch: Record<string, unknown> = {}): TerminalContextSnapshot => ({
  available: true, leafId: 1, ptyId: 10, cwd: "/work", capturedAt: 100,
  kubeconfig: "./team.yaml:/fixture/other.yaml", defaultKubeconfigPath: null,
  dockerConfig: "/fixture/docker", dockerContext: null, dockerHost: false, ...patch,
} as TerminalContextSnapshot);
let root: Root, host: HTMLDivElement;
function Probe({ snapshot, connected, enabled }: { snapshot: TerminalStatusSnapshot | null; connected: boolean; enabled: typeof both }) {
  const value = useTerminalContexts(snapshot, connected, enabled);
  return <output>{JSON.stringify(value)}</output>;
}
const value = () => JSON.parse(host.textContent!);
async function render(snapshot: TerminalStatusSnapshot | null = local(), connected = true, enabled = both) {
  await act(async () => root.render(<Probe snapshot={snapshot} connected={connected} enabled={enabled} />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  fixture.capture.mockReturnValue(metadata()); fixture.invoke.mockResolvedValue(config);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.restoreAllMocks();
});

it("reads only the selected terminal's explicitly reported paths and selectors", async () => {
  await render();
  expect(value()).toEqual(config);
  expect(fixture.capture).toHaveBeenCalledWith(1);
  expect(fixture.invoke).toHaveBeenCalledWith("terminal_resolve_contexts", { request: {
    cwd: "/work", kubeconfig: "./team.yaml:/fixture/other.yaml", defaultKubeconfigPath: null,
    dockerConfig: "/fixture/docker", dockerContext: null, dockerHost: false, ...both,
  } });
  expect(fixture.invoke).toHaveBeenCalledTimes(1);
});

it.each([
  [null, true, both],
  [local({ scope: "remote", host: "server" }), true, both],
  [local({ scope: "unknown" }), true, both],
  [local({ atPrompt: false }), true, both],
  [local({ command: "kubectl get pods", startedAt: 1 }), true, both],
  [local(), false, both],
  [local(), true, { kubernetes: false, docker: false }],
  [local({ cwd: null }), true, both],
])("does not inspect unavailable, remote, busy, unverified or irrelevant terminals %#", async (snapshot, connected, enabled) => {
  await render(snapshot, connected, enabled);
  expect(value().kubernetes).toBeNull(); expect(value().docker).toBeNull();
  expect(fixture.invoke).not.toHaveBeenCalled();
});

it.each([
  { available: false, reason: "No prompt metadata" }, metadata({ cwd: "/different" }), metadata({ leafId: 2 }),
])("refuses stale or unavailable capture without guessing application defaults %#", async capture => {
  fixture.capture.mockReturnValue(capture); await render();
  expect(value().kubernetes).toBeNull(); expect(fixture.invoke).not.toHaveBeenCalled();
});

it("drops values immediately on Enter, disconnect, SSH and pane changes", async () => {
  await render(); expect(value().kubernetes.context).toBe("staging");
  await render(local({ atPrompt: false })); expect(value().kubernetes).toBeNull();
  await render(local({ promptRevision: 2 })); expect(value().kubernetes.context).toBe("staging");
  await render(local({ scope: "remote", scopeKey: "one:2" })); expect(value().kubernetes).toBeNull();
  await render(local({ leafId: 2, scopeKey: "two:1" })); expect(value().kubernetes).toBeNull();
  await render(local(), false); expect(value().kubernetes).toBeNull();
});

it("ignores late responses after the terminal enters SSH", async () => {
  let finish!: (value: unknown) => void;
  fixture.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await render(local({ scope: "remote", scopeKey: "one:2" }));
  await act(async () => finish(config));
  expect(value().kubernetes).toBeNull(); expect(value().kubernetesReason).toContain("Remote");
});

it.each([
  metadata({ ptyId: 11 }), metadata({ capturedAt: 101 }), metadata({ dockerContext: "other" }),
  { available: false, reason: "Scope changed" },
])("rejects responses when the capture changed during the read %#", async capture => {
  let finish!: (value: unknown) => void;
  fixture.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); fixture.capture.mockReturnValue(capture);
  await act(async () => finish(config));
  expect(value().kubernetes).toBeNull(); expect(value().docker).toBeNull();
});

it("refreshes metadata each completed prompt, including empty Enter", async () => {
  await render(); fixture.invoke.mockResolvedValue({ ...config, kubernetes: { ...config.kubernetes, context: "dev" } });
  fixture.capture.mockReturnValue(metadata({ capturedAt: 101 }));
  await render(local({ promptRevision: 2 }));
  expect(value().kubernetes.context).toBe("dev"); expect(fixture.invoke).toHaveBeenCalledTimes(2);
});

it("refreshes external config edits and discards old labels after read errors", async () => {
  await render();
  fixture.invoke.mockResolvedValue({ ...config, docker: { context: "remote-engine", source: "config" } });
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(value().docker.context).toBe("remote-engine");
  fixture.invoke.mockRejectedValue(new Error("private contents must not be shown"));
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(value().docker).toBeNull(); expect(host.textContent).not.toContain("private contents");
});

it("keeps at most one native read in flight across prompt changes", async () => {
  let finish!: (value: unknown) => void;
  fixture.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await render(local({ promptRevision: 2 }));
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(fixture.invoke).toHaveBeenCalledTimes(1);
  await act(async () => finish(config));
  expect(value().kubernetes).toBeNull();
  fixture.invoke.mockResolvedValue(config);
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(value().kubernetes.context).toBe("staging");
});

it("does not poll hidden windows and refreshes after visibility returns", async () => {
  await render();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(value().kubernetes).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(20_000));
  expect(fixture.invoke).toHaveBeenCalledTimes(1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(fixture.invoke).toHaveBeenCalledTimes(2); expect(value().kubernetes.context).toBe("staging");
});

it("does not revive a read started before a sleep/wake visibility transition", async () => {
  let finish!: (value: unknown) => void;
  fixture.invoke.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render();
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => finish(config));
  expect(value().kubernetes).toBeNull();
});

it("validates native labels and strips unrelated metadata from the display", () => {
  expect(parseTerminalContexts({ ...config, secret: "private", docker: { ...config.docker, credential: "secret" } }, both)).toEqual(config);
  expect(parseTerminalContexts(config, { kubernetes: false, docker: false })).toEqual({
    kubernetes: null, docker: null, kubernetesReason: null, dockerReason: null,
  });
  for (const label of ["", " ", "x\nsecret", "\u202esecret", "x".repeat(513)]) {
    expect(parseTerminalContexts({ ...config, kubernetes: { ...config.kubernetes, context: label }, docker: { ...config.docker, context: label } }, both).kubernetes).toBeNull();
    expect(parseTerminalContexts({ ...config, docker: { ...config.docker, context: label } }, both).docker).toBeNull();
  }
  expect(parseTerminalContexts(null, both).kubernetes).toBeNull();
});
