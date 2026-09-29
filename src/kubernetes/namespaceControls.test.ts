// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("./namespaceAccess", async original => ({ ...await original<typeof import("./namespaceAccess")>(), checkNamespaceAccess: vi.fn() }));
import { checkNamespaceAccess, type NamespaceAccessResult } from "./namespaceAccess";
import { K8sAccessCheck } from "./K8sAccessCheck";
import { K8sNamespacePicker } from "./K8sNamespacePicker";
import type { K8sReadScope } from "./configSource";

let root: Root;
let host: HTMLDivElement;
const scope: K8sReadScope = { context: "dev", config: { kind: "file", paths: ["/fixtures/team"], fingerprint: "one", cwd: "/fixtures", missingPaths: [], label: "File" } };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.resetAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const renderCheck = (namespace = "team-a", resources = ["pods"], selected = scope) => act(async () => root.render(createElement(K8sAccessCheck, { namespace, resources, scope: selected })));
const click = (label: string) => act(async () => {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(button, label).toBeDefined(); button!.click();
});

it("checks only on explicit request, pins its scope, and distinguishes denial from unavailable evidence", async () => {
  vi.mocked(checkNamespaceAccess).mockResolvedValue([
    { resource: "pods", allowed: true }, { resource: "secrets", allowed: false },
    { resource: "configmaps", allowed: null, error: "Connection timed out" },
  ]);
  await renderCheck("team-a", ["pods", "secrets", "configmaps"]);
  expect(checkNamespaceAccess).not.toHaveBeenCalled();
  await click("Check access");
  expect(checkNamespaceAccess).toHaveBeenCalledExactlyOnceWith("team-a", ["pods", "secrets", "configmaps"], scope);
  expect(host.querySelector('[data-access="allowed"]')?.textContent).toBe("Allowed");
  expect(host.querySelector('[data-access="denied"]')?.textContent).toBe("Not allowed");
  expect(host.querySelector('[data-access="unknown"]')?.textContent).toBe("Unavailable");
  expect(host.textContent).toContain("Connection timed out");
  expect(host.textContent).toContain("No permissions are changed");
  await click("Dismiss access results");
  expect(host.querySelector('[aria-label="Access check results"]')).toBeNull();
});

it.each(["namespace", "context", "file", "category"])("does not display delayed access results after changing %s", async change => {
  let finish!: (results: NamespaceAccessResult[]) => void;
  vi.mocked(checkNamespaceAccess).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await renderCheck(); await click("Check access");
  const nextScope = change === "context" ? { ...scope as Exclude<K8sReadScope, string>, context: "prod" }
    : change === "file" ? { ...scope as Exclude<K8sReadScope, string>, config: { ...(scope as Exclude<K8sReadScope, string>).config, fingerprint: "two", paths: ["/fixtures/other"] } } : scope;
  await renderCheck(change === "namespace" ? "team-b" : "team-a", change === "category" ? ["services"] : ["pods"], nextScope);
  await act(async () => finish([{ resource: "pods", allowed: false }]));
  expect(host.querySelector('[aria-label="Access check results"]')).toBeNull();
  expect(host.querySelector("button")!.disabled).toBe(false);
});

it("clears a completed result when changing namespace and disables checks with no namespace", async () => {
  vi.mocked(checkNamespaceAccess).mockResolvedValue([{ resource: "pods", allowed: true }]);
  await renderCheck(); await click("Check access");
  await renderCheck("");
  expect(host.querySelector('[aria-label="Access check results"]')).toBeNull();
  expect(host.querySelector("button")!.disabled).toBe(true);
});

it("reports a failed access-check request without claiming permission denial", async () => {
  vi.mocked(checkNamespaceAccess).mockRejectedValue(new Error("Native bridge unavailable"));
  await renderCheck(); await click("Check access");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Native bridge unavailable");
  expect(host.querySelector('[data-access="denied"]')).toBeNull();
});

it("keeps a manually selected namespace in options even when it was not discovered", async () => {
  const onChange = vi.fn();
  await act(async () => root.render(createElement(K8sNamespacePicker, { namespace: "team-a", namespaces: [], defaultNamespace: "default", loadingDefault: false, defaultError: "", discoveryError: "Forbidden", disabled: false, onChange })));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("team-a");
  expect(host.textContent).toContain("listing namespaces is a separate permission");
  await click("Enter manually");
  expect(host.querySelector<HTMLInputElement>('[aria-label="Namespace name"]')!.value).toBe("team-a");
  await click("Cancel");
  expect(onChange).not.toHaveBeenCalled();
  expect(host.querySelector("form")).toBeNull();
});
