import { afterEach, describe, expect, it } from "vitest";

import { isEnvDestructive, type EnvSignals } from "./envSignals";
import {
  clearEnvironmentWarning,
  getEnvironmentWarning,
  protectedTargetsForCommand,
  recordEnvironmentWarning,
} from "./environmentWarnings";

const leaf = 9_246;
const productionSignals: EnvSignals = {
  kubeContext: "production-us-east-1",
  awsProfile: "prod-account",
  dockerContext: "default",
  terraformWorkspace: "production",
  checkedAt: 0,
};

afterEach(() => clearEnvironmentWarning(leaf));

describe("environment mismatch warning", () => {
  it("stays quiet for read-only commands", () => {
    expect(protectedTargetsForCommand("kubectl get pods", productionSignals)).toEqual([]);
    expect(protectedTargetsForCommand("terraform plan", productionSignals)).toEqual([]);
  });

  it("names the protected target a mutating command can affect", () => {
    expect(isEnvDestructive("kubectl apply -f deployment.yaml")).toBe(true);
    expect(protectedTargetsForCommand("kubectl apply -f deployment.yaml", productionSignals)).toEqual([
      {
        kind: "kubernetes",
        value: "production-us-east-1",
        inspectCommand: "kubectl config current-context",
      },
    ]);

    expect(protectedTargetsForCommand("terraform apply", productionSignals).map((target) => target.kind)).toEqual([
      "aws",
      "terraform",
    ]);
  });

  it("keeps the warning scoped to the terminal leaf that started the command", () => {
    recordEnvironmentWarning(leaf, {
      command: "aws ec2 terminate-instances --instance-ids i-123",
      cwd: "/work/husk",
      env: productionSignals,
      at: 10,
    });
    expect(getEnvironmentWarning(leaf)).toMatchObject({
      leafId: leaf,
      command: "aws ec2 terminate-instances --instance-ids i-123",
      targets: [{ kind: "aws", value: "prod-account" }],
    });
  });
});
