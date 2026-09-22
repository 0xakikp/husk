import { useSyncExternalStore } from "react";
import type { Workflow } from "./store";
let requested: Workflow | null = null;
const subscribers = new Set<() => void>();
export function requestWorkflowRun(workflow: Workflow) { requested = structuredClone(workflow); subscribers.forEach((fn) => fn()); }
export function clearWorkflowRunRequest() { requested = null; subscribers.forEach((fn) => fn()); }
export function useWorkflowRunRequest() { return useSyncExternalStore((fn) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }, () => requested, () => null); }
