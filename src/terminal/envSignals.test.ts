import { describe, expect, it } from "vitest";

import { assessTerminalPilotCommand } from "../ai/terminalPilot";
import { environmentRunReview, isEnvDestructive, protectedReason, protectedTargets } from "./envSignals";

describe("command-scoped infrastructure safety", () => {
  it.each([
    "kubectl apply -f app.yaml",
    "kubectl --context=prod -n app apply -f app.yaml",
    "kubectl --context prod rollout restart deployment/app",
    "helm --kube-context prod upgrade app ./chart",
    "aws --profile prod --region us-east-1 ec2 terminate-instances --instance-ids i-123",
    "AWS_PROFILE=prod aws ec2 terminate-instances --instance-ids i-123",
    "docker --context prod system prune",
    "docker -c prod container rm app",
    "TF_WORKSPACE=prod terraform -chdir=infra apply",
    "terraform apply",
    "pnpm deploy",
    "./deploy production",
  ])("requires approval without any global environment probe: %s", (command) => {
    expect(isEnvDestructive(command)).toBe(true);
    expect(environmentRunReview(command)).not.toBeNull();
  });

  it.each([
    "kubectl --context prod get pods",
    "aws --profile prod ec2 describe-instances",
    "docker --context prod ps",
    "TF_WORKSPACE=prod terraform plan",
    "pwd",
  ])("does not classify read-only commands as mutations: %s", (command) => {
    expect(isEnvDestructive(command)).toBe(false);
    expect(environmentRunReview(command)).toBeNull();
  });

  it("reviews unknown targets without claiming the app's defaults are terminal state", () => {
    expect(protectedTargets("kubectl apply -f app.yaml")).toEqual([]);
    expect(environmentRunReview("kubectl apply -f app.yaml")).toEqual({
      productionTarget: null,
      message: "Infrastructure-changing command — verify the terminal's target before approving",
    });
  });

  it("names explicit overrides and observed protected SSH hosts only", () => {
    expect(protectedTargets("kubectl --context prod apply -f app.yaml", "production-host"))
      .toEqual(["kubernetes/prod", "SSH/production-host"]);
    expect(protectedTargets("aws --profile staging ec2 stop-instances", "development-host")).toEqual([]);
    expect(protectedTargets("TF_WORKSPACE=live terraform apply")).toEqual(["terraform/live"]);
    expect(environmentRunReview("kubectl delete pod old", "production-host")?.productionTarget)
      .toBe("SSH/production-host");
  });

  it("does not persist a previous command's protected target", () => {
    expect(protectedTargets("aws --profile prod ec2 stop-instances")).toEqual(["aws/prod"]);
    expect(protectedTargets("aws ec2 stop-instances")).toEqual([]);
  });

  it("preserves Pilot's review policy for infra with unknown targets and production SSH diagnostics", () => {
    const mutation = "terraform apply";
    expect(assessTerminalPilotCommand(mutation, protectedTargets(mutation)).kind).toBe("review");
    expect(assessTerminalPilotCommand("pwd", protectedTargets("pwd", "prod-host")).kind).toBe("review");
    expect(assessTerminalPilotCommand("pwd", protectedTargets("pwd")).kind).toBe("safe");
  });

  it("keeps production-pattern matching but does not call git branches production targets", () => {
    expect(protectedReason("kubernetes", "production")).toBe("matches production pattern");
    expect(protectedReason("git", "production")).toBeNull();
  });
});
