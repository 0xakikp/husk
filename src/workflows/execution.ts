import { invoke } from "@tauri-apps/api/core";
import { getActiveTerminalLeafId, getSessionHandle } from "../terminal/registry";
import { captureScreenCommandTarget, type ScreenCommandTarget } from "../terminal/stageScreenCommand";
import { isCurrentTerminalTarget } from "../ai/terminalTarget";
import { compileWorkflow } from "./params";
import type { Workflow } from "./store";

export type WorkflowTarget = { leafId: number; scope: ScreenCommandTarget };
export function captureWorkflowTarget(): WorkflowTarget | null {
  const leafId = getActiveTerminalLeafId();
  const scope = leafId == null ? null : captureScreenCommandTarget(leafId);
  return leafId != null && scope && scope.cwd && (!scope.isRemote || scope.host) ? { leafId, scope } : null;
}
export function workflowTargetError(target: WorkflowTarget | null): string | null {
  if (!target) return "No verified terminal scope. Focus an idle shell with working-directory integration, then select Refresh target.";
  const current = captureWorkflowTarget();
  if (!current || current.leafId !== target.leafId || current.scope.scopeToken !== target.scope.scopeToken || !isCurrentTerminalTarget(target.scope)) return "The terminal, directory, or connection changed. Refresh the target and review again.";
  const prompt = getSessionHandle(target.leafId)?.getPromptReadiness();
  return prompt?.ready ? null : prompt?.reason || "Terminal prompt is unavailable.";
}
const pending = new Set<number>();
/** Execute only after the reviewed target and complete command are rechecked. */
export async function executeWorkflow(wf: Workflow, values: Record<string, string>, target: WorkflowTarget | null, reviewedCommand: string): Promise<void> {
  const compiled = compileWorkflow(wf, values);
  if (compiled.command !== reviewedCommand) throw new Error("Workflow changed after review. Preview it again.");
  const error = workflowTargetError(target); if (error || !target) throw new Error(error || "No target.");
  if (pending.has(target.leafId)) throw new Error("This terminal already has a workflow submission in progress.");
  pending.add(target.leafId);
  try {
    await invoke("pty_write", { id: target.scope.ptyId, data: compiled.command + "\r" });
    if (isCurrentTerminalTarget(target.scope)) getSessionHandle(target.leafId)?.focus();
  } finally { pending.delete(target.leafId); }
}
