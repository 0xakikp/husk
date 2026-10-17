import { afterEach, describe, expect, it } from "vitest";

import { isEnvDestructive } from "./envSignals";
import {
  clearEnvironmentWarning,
  getEnvironmentWarning,
  protectedTargetsForCommand,
  recordEnvironmentWarning,
} from "./environmentWarnings";

const leaf = 9_246;
afterEach(() => {
  clearEnvironmentWarning(leaf);
  clearEnvironmentWarning(leaf + 1);
});

describe("environment mismatch warning", () => {
  it("stays quiet for read-only commands", () => {
    expect(protectedTargetsForCommand("kubectl --context production get pods")).toEqual([]);
    expect(protectedTargetsForCommand("TF_WORKSPACE=production terraform plan")).toEqual([]);
  });

  it("names the protected target a mutating command can affect", () => {
    expect(isEnvDestructive("kubectl apply -f deployment.yaml")).toBe(true);
    expect(protectedTargetsForCommand("kubectl --context production-us-east-1 apply -f deployment.yaml")).toEqual([
      {
        kind: "kubernetes",
        value: "production-us-east-1",
        inspectCommand: "kubectl config get-contexts 'production-us-east-1'",
      },
    ]);

    expect(protectedTargetsForCommand("TF_WORKSPACE=production terraform apply").map((target) => target.kind)).toEqual([
      "terraform",
    ]);
  });

  it("keeps the warning scoped to the terminal leaf that started the command", () => {
    recordEnvironmentWarning(leaf, {
      command: "aws --profile prod-account ec2 terminate-instances --instance-ids i-123",
      cwd: "/work/husk",
      at: 10,
    });
    expect(getEnvironmentWarning(leaf)).toMatchObject({
      leafId: leaf,
      command: "aws --profile prod-account ec2 terminate-instances --instance-ids i-123",
      targets: [{ kind: "aws", value: "prod-account" }],
    });
    expect(getEnvironmentWarning(leaf + 1)).toBeNull();
  });

  it("does not invent a shell target from missing defaults or another command", () => {
    expect(protectedTargetsForCommand("kubectl apply -f deployment.yaml")).toEqual([]);
    expect(protectedTargetsForCommand("aws ec2 terminate-instances --instance-ids i-123")).toEqual([]);
    expect(protectedTargetsForCommand("kubectl --context production get pods && kubectl --context staging apply -f app.yaml")).toEqual([]);
  });

  it("stages inspection of the explicit target rather than an app default", () => {
    expect(protectedTargetsForCommand("aws --profile prod-account ec2 stop-instances --instance-ids i-123")[0].inspectCommand)
      .toBe("aws --profile 'prod-account' configure list");
    expect(protectedTargetsForCommand("docker --context live-server system prune")[0].inspectCommand)
      .toBe("docker context inspect 'live-server'");
    expect(protectedTargetsForCommand("TF_WORKSPACE=production terraform apply")[0].inspectCommand)
      .toBe("TF_WORKSPACE='production' terraform workspace show");
  });

  it("clears stale warnings when a terminal submits a new command", () => {
    recordEnvironmentWarning(leaf, { command: "kubectl --context prod delete pod old", cwd: "/work" });
    expect(getEnvironmentWarning(leaf)).not.toBeNull();
    recordEnvironmentWarning(leaf, { command: "pwd", cwd: "/work" });
    expect(getEnvironmentWarning(leaf)).toBeNull();
  });

  it("covers secondary selectors and new adapters without inventing inspection commands", () => {
    expect(protectedTargetsForCommand("gcloud --project demo --configuration production compute instances delete old")).toEqual([
      { kind: "gcloud", value: "production", inspectCommand: null },
    ]);
    expect(protectedTargetsForCommand("az --subscription prod vm delete --name old")).toEqual([
      { kind: "azure", value: "prod", inspectCommand: null },
    ]);
    expect(protectedTargetsForCommand("oci --profile dev --region prod-region compute instance terminate")).toEqual([
      { kind: "oci", value: "prod-region", inspectCommand: null },
    ]);
    expect(protectedTargetsForCommand("podman --connection live rm old")).toEqual([
      { kind: "podman", value: "live", inspectCommand: null },
    ]);
  });
});
