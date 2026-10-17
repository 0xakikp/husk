import { describe, expect, it } from "vitest";

import { assessTerminalPilotCommand } from "../ai/terminalPilot";
import { environmentRunReview, isEnvDestructive, isStatusToolMutation, protectedReason, protectedTargets } from "./envSignals";
import { detectStatusToolSignals } from "./statusBarTools";

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

  it.each([
    "oci --profile prod compute instance terminate --instance-id ocid1.instance.example",
    "oci compute instance action --action STOP --instance-id ocid1.instance.example",
    "az --subscription prod vm delete --name app --resource-group example",
    "az --subscription list vm delete --name app",
    "az group deployment create --parameters list",
    "gcloud --project prod compute instances delete app",
    "gcloud --project list compute instances delete app",
    "gcloud --configuration staging run deploy app --project prod",
    "podman --connection prod rm app",
    "podman -c prod volume rm data",
    "podman machine rm prod",
    "podman --connection prod run example --help",
    "orb delete prod",
    "orbctl delete prod",
    "orb -m prod rm data",
    "orbctl run -m prod sh -c 'echo list; rm data'",
    "orb run --help",
    "colima --profile prod stop",
    "colima -p prod delete",
    "colima ssh -- echo status",
    "oci extension unknown-command list",
    "az extension run list",
    "gcloud new-service unknown-command list",
    "podman new-command list",
    "orb new-command list",
    "orbctl new-command list",
    "colima new-command status",
  ])("reviews new infrastructure mutations or uncertain actions: %s", (command) => {
    expect(isEnvDestructive(command)).toBe(true);
    expect(environmentRunReview(command)).not.toBeNull();
  });

  it.each([
    "oci --profile prod --region us-ashburn-1 compute instance list --compartment-id ocid1.compartment.example",
    "oci --profile=prod compute instance get --instance-id ocid1.instance.example",
    "oci iam region list",
    "oci --help",
    "az --subscription prod vm list --output table",
    "az vm show --subscription prod --name app --resource-group example",
    "az account show",
    "az --version",
    "gcloud --project prod compute instances list",
    "gcloud compute instances describe app --project=prod --zone us-central1-a",
    "gcloud config get-value project",
    "gcloud auth list",
    "podman --connection prod ps --all",
    "podman -c prod container inspect app",
    "podman system connection list",
    "podman machine list",
    "orb list",
    "orb -m prod info",
    "orbctl info prod",
    "orbctl status",
    "colima --profile prod status",
    "colima list",
    "colima --help",
  ])("keeps narrowly recognized read/utility paths out of extra infrastructure review: %s", (command) => {
    expect(isEnvDestructive(command)).toBe(false);
    expect(environmentRunReview(command)).toBeNull();
  });

  it.each([
    "az --unknown-option list vm delete",
    "gcloud --flags-file flags.yaml compute instances list",
    "oci --unknown-option profile compute instance list",
    "podman --unknown-option connection ps",
    "colima --unknown-option profile list",
    "orb --unknown-option machine list",
    "gcloud $FLAGS compute instances list",
    "az vm list --subscription $SUBSCRIPTION",
    "podman --connection prod run image -- list",
  ])("does not grant a read exemption to ambiguous options or payloads: %s", (command) => {
    expect(isEnvDestructive(command)).toBe(true);
  });

  it("requires review for new infrastructure mutations even without a verified target", () => {
    for (const command of ["oci compute instance terminate", "az vm delete", "gcloud compute instances delete app",
      "podman rm app", "orbctl delete dev", "colima stop"]) {
      expect(environmentRunReview(command)).toEqual({
        productionTarget: null,
        message: "Infrastructure-changing command — verify the terminal's target before approving",
      });
    }
  });

  it("checks every explicit selector, not only the primary selector shown in the bar", () => {
    expect(protectedTargets("gcloud --project staging --configuration prod compute instances delete app"))
      .toEqual(["gcloud/prod"]);
    expect(protectedTargets("oci --profile staging --region live-region compute instance terminate"))
      .toEqual(["oci/live-region"]);
    expect(protectedTargets("gcloud --project prod-app --configuration live compute instances delete app", "production-host"))
      .toEqual(["gcloud/prod-app", "gcloud/live", "SSH/production-host"]);
    expect(environmentRunReview("gcloud --project staging --configuration prod compute instances delete app")?.productionTarget)
      .toBe("gcloud/prod");
  });

  it("does not equate development/connection activity with infrastructure mutation", () => {
    for (const command of ["python --version", "python3 app.py", "uv run --python 3.13 check.py", "conda run -n app python --version", "ssh prod-host"]) {
      const [signal] = detectStatusToolSignals(command);
      expect(signal).toBeDefined();
      expect(isStatusToolMutation(signal)).toBe(false);
    }
  });
});
