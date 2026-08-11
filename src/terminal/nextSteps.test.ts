import { afterEach, describe, expect, it } from "vitest";
import {
  clearNextSteps,
  getNextSteps,
  isMeaningfulCompletedCommand,
  localNextSteps,
  recordNextSteps,
} from "./nextSteps";

const leaf = 917;

afterEach(() => clearNextSteps(leaf));

describe("terminal next steps", () => {
  it("turns a deployed Kubernetes workload into safe verification commands", () => {
    const steps = localNextSteps(
      "kubectl apply -n staging -f deployment.yaml",
      "deployment.apps/husk configured",
    );
    expect(steps.map((step) => step.command)).toEqual([
      "kubectl rollout status deployment/'husk' -n 'staging'",
      "kubectl get events -n 'staging' --sort-by=.lastTimestamp | tail -20",
    ]);
  });

  it("adds an AI-ready record for a meaningful successful command", () => {
    recordNextSteps(leaf, {
      command: "terraform apply",
      output: "Apply complete!",
      exitCode: 0,
      cwd: "/work/husk",
      at: 1,
    });
    expect(getNextSteps(leaf)?.record.local.map((step) => step.label)).toEqual([
      "inspect outputs",
      "list state",
    ]);
  });

  it("does not interrupt simple shell navigation", () => {
    expect(isMeaningfulCompletedCommand("cd src")).toBe(false);
    expect(isMeaningfulCompletedCommand("pwd")).toBe(false);
    expect(isMeaningfulCompletedCommand("kubectl apply -f app.yaml")).toBe(true);
  });
});
