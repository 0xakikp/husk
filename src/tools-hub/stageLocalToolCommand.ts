import { getActiveTerminalLeafId } from "../terminal/registry";
import { captureScreenCommandTarget, stageScreenCommand } from "../terminal/stageScreenCommand";
import { toast } from "../toast";

const pendingLeaves = new Set<number>();

/** Built-in tools inspect local data. Never send their commands to an SSH
 * session or execute immediately. The shared writer verifies an idle prompt. */
export async function stageLocalToolCommand(command: string): Promise<void> {
  const leafId = getActiveTerminalLeafId();
  const target = leafId == null ? null : captureScreenCommandTarget(leafId);
  if (leafId == null || !target || target.isRemote || target.host !== null) throw new Error("Focus a verified local terminal first. This tool cannot stage commands into SSH.");
  if (pendingLeaves.has(leafId)) throw new Error("A command is already being staged in this terminal.");
  pendingLeaves.add(leafId);
  try { await stageScreenCommand(leafId, target, command); }
  finally { pendingLeaves.delete(leafId); }
}

export async function stageLocalToolCommandWithNotice(command: string): Promise<void> {
  try {
    await stageLocalToolCommand(command);
    toast({ title: "Command staged, not run", message: "Check the command and local CLI context before pressing Enter.", variant: "info" });
  } catch (reason) {
    toast({ title: "Command was not staged", message: reason instanceof Error ? reason.message : String(reason), variant: "error" });
  }
}
