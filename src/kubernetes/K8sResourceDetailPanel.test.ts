// @vitest-environment happy-dom
import { act, createElement, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("./WorkloadDetailPanel", () => ({ default: ({ kind, name }: { kind: string; name: string }) => createElement("div", { "data-workload": kind }, name) }));
import K8sResourceDetailPanel from "./K8sResourceDetailPanel";
import { K8sInspectorProvider } from "./K8sInspectorContext";
import { ConceptHelp, RelationshipLinks } from "./K8sDetailCommon";
import type { K8sResourceSelection } from "./KubernetesView";

let root: Root;
let host: HTMLDivElement;
const navigate = vi.fn();
const selection: K8sResourceSelection = { context: "production cluster", kind: "deployment", namespace: "apps", name: "web" };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); navigate.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it.each(["replicaset", "statefulset", "daemonset"] as const)("routes %s to a working inspector", async (kind) => {
  await act(async () => { root.render(createElement(Suspense, { fallback: "Loading" }, createElement(K8sResourceDetailPanel, { selection: { ...selection, kind }, onNavigate: navigate, onClose: () => {} }))); });
  expect(host.querySelector(`[data-workload="${kind}"]`)?.textContent).toBe("web");
});

it("relationship navigation preserves context and namespace, leaving unsupported owners as text", async () => {
  await act(async () => { root.render(createElement(K8sInspectorProvider, { selection, onNavigate: navigate, children:
    createElement(RelationshipLinks, { items: [{ kind: "ReplicaSet", name: "web-rs" }, { kind: "CustomOwner", name: "custom" }] }) })); });
  expect(host.querySelectorAll("button")).toHaveLength(1);
  await act(async () => host.querySelector("button")!.click());
  expect(navigate).toHaveBeenCalledWith({ context: "production cluster", namespace: "apps", kind: "replicaset", name: "web-rs" });
});

it("explains concepts offline with the inspected scope's read-only command", async () => {
  await act(async () => { root.render(createElement(K8sInspectorProvider, { selection, onNavigate: navigate, children:
    createElement(ConceptHelp, { concept: "readiness", value: "0/2 ready" }) })); });
  expect(host.textContent).toContain("Running is not the same as ready");
  expect(host.textContent).toContain("0/2 ready");
  expect(host.querySelector("code")?.textContent).toContain("--context 'production cluster'");
  expect(host.querySelector("code")?.textContent).toContain("get 'deployment' 'web'");
  expect(navigate).not.toHaveBeenCalled();
});
