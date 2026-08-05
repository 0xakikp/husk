import { getWorkspaceRoot } from "../workspace/store";
import { getProjectProfile, type Runbook } from "./profile";
import { runInActiveTerminal, typeInActiveTerminal } from "../ai/terminalContext";
import { getEnvSignals, isProtectedTarget, matchesPattern } from "../terminal/envSignals";
import { toast } from "../toast";

/**
 * Runbook execution.
 *
 * The exact command is always visible: either announced in a toast as it
 * runs, or — for recipes marked confirm, or when the current environment is a
 * protected target — typed at the prompt so the user reviews it and presses
 * Enter themselves. Husk never runs a risky recipe silently.
 */

/** Current protected targets from live environment signals + profile rules. */
export function protectedTargets(): string[] {
  const safety = getProjectProfile()?.safety;
  const env = getEnvSignals();
  const hits: string[] = [];
  if (env.kubeContext) {
    const listed = (safety?.protected_kubernetes_contexts ?? []).some((p) => matchesPattern(p, env.kubeContext!));
    if (listed || isProtectedTarget(env.kubeContext)) hits.push(`kubernetes/${env.kubeContext}`);
  }
  if (env.awsProfile) {
    const listed = (safety?.protected_aws_profiles ?? []).some((p) => matchesPattern(p, env.awsProfile!));
    if (listed || isProtectedTarget(env.awsProfile)) hits.push(`aws/${env.awsProfile}`);
  }
  const envLabels = safety?.protected_environments ?? [];
  for (const label of envLabels) {
    if (env.kubeContext && matchesPattern(label, env.kubeContext) && !hits.some((h) => h.includes(env.kubeContext!))) {
      hits.push(`kubernetes/${env.kubeContext}`);
    }
  }
  return hits;
}

export function runRunbook(rb: Runbook): void {
  const command = (rb.command ?? "").trim();
  if (!command) return;
  const root = getWorkspaceRoot();
  const cwd = rb.cwd?.trim();
  const full = cwd && cwd !== "." && root ? `cd ${root}/${cwd} && ${command}` : command;
  const title = rb.title || rb.id || "runbook";

  const protectedHits = protectedTargets();

  if (rb.confirm || protectedHits.length > 0) {
    /* Review gate: the command lands at the prompt unexecuted. Pressing Enter
       is the confirmation — deliberate, visible, and impossible to trigger by
       accident from the palette. */
    if (!typeInActiveTerminal(full)) {
      toast({ title: "No active terminal", message: "Open a terminal to run this runbook.", variant: "error" });
      return;
    }
    toast({
      title: protectedHits.length > 0 ? `⚠ ${title} — targeting ${protectedHits[0]}` : `Confirm: ${title}`,
      message: `${full} — review at the prompt, Enter to run`,
      variant: protectedHits.length > 0 ? "warning" : "info",
      duration: 5000,
    });
    return;
  }

  if (!runInActiveTerminal(full)) {
    toast({ title: "No active terminal", message: "Open a terminal to run this runbook.", variant: "error" });
    return;
  }
  toast({ title: `Running: ${title}`, message: full, variant: "info" });
}
