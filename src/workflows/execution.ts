import { getActiveTerminalLeafId, getSessionHandle, submitTrackedTerminalCommand } from "../terminal/registry";
import { captureScreenCommandTarget, type ScreenCommandTarget } from "../terminal/stageScreenCommand";
import { isCurrentTerminalTarget } from "../ai/terminalTarget";
import { compileWorkflow } from "./params";
import type { Workflow } from "./store";
import { beginWorkflowRun, markWorkflowRunSubmitted, markWorkflowRunWriteFailed } from "./runStatus";

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
export async function executeWorkflow(wf: Workflow, values: Record<string, string>, target: WorkflowTarget | null, reviewedCommand: string, options: { localOnly?: boolean } = {}): Promise<void> {
  const compiled = compileWorkflow(wf, values);
  if (compiled.command !== reviewedCommand) throw new Error("Workflow changed after review. Preview it again.");
  const error = workflowTargetError(target); if (error || !target) throw new Error(error || "No target.");
  if (options.localOnly && target.scope.isRemote) throw new Error("Linked local scripts can only run in a local terminal. Refresh the target in the intended local terminal.");
  if (target.scope.ptyId === null) throw new Error("The terminal connection is unavailable.");
  if (pending.has(target.leafId)) throw new Error("This terminal already has a workflow submission in progress.");
  pending.add(target.leafId);
  const kind = options.localOnly ? "script" : "workflow";
  let runId: string | undefined;
  try {
    await submitTrackedTerminalCommand(target.leafId, { ...target.scope, ptyId: target.scope.ptyId }, compiled.command, receipt => {
      runId = receipt;
      beginWorkflowRun(wf, values, target, compiled.command, receipt, kind);
    });
    if (runId) markWorkflowRunSubmitted(wf.id, runId, kind);
    if (isCurrentTerminalTarget(target.scope)) getSessionHandle(target.leafId)?.focus();
  } catch (error) {
    if (runId) markWorkflowRunWriteFailed(wf.id, runId, kind);
    throw error;
  } finally { pending.delete(target.leafId); }
}
