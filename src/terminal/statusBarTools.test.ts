import { describe, expect, it } from "vitest";

import {
  canonicalStatusToolId, commandToolLabel, detectCommandToolActivities, detectStatusToolSignals, isCommandToolId,
  literalStatusValue, statusCommandInvocations, statusToolOverrides,
  STATUS_TOOL_CATALOG, STATUS_TOOL_LABELS, STATUS_TOOLS,
} from "./statusBarTools";

function onlySignal(command: string) {
  const signals = detectStatusToolSignals(command);
  expect(signals).toHaveLength(1);
  return signals[0];
}

describe("terminal-local status tools", () => {
  it("provides stable preference IDs independently of observed command data", () => {
    expect(STATUS_TOOLS.slice(0, 4)).toEqual(["kubernetes", "docker", "aws", "terraform"]);
    expect(STATUS_TOOLS.slice(0, 4).map((tool) => STATUS_TOOL_LABELS[tool])).toEqual([
      "Kubernetes", "Docker", "AWS", "Terraform",
    ]);
    expect(STATUS_TOOLS).toEqual(expect.arrayContaining([
      "oci", "azure", "gcloud", "orbstack", "podman", "colima", "python", "conda", "ssh",
    ]));
  });

  it.each([
    ["kubectl get pods", "kubernetes"],
    ["helm list", "kubernetes"],
    ["docker ps", "docker"],
    ["aws sts get-caller-identity", "aws"],
    ["terraform plan", "terraform"],
    ["/opt/homebrew/bin/kubectl get namespaces", "kubernetes"],
  ])("recognises a direct tool without guessing its target: %s", (command, tool) => {
    expect(onlySignal(command)).toMatchObject({ tool, command, override: null });
  });

  it.each([
    "", "git status", "echo kubectl get pods", "printf 'aws --profile prod sts get-caller-identity'",
    "# terraform apply", "echo hello # docker ps", "echo 'kubectl'; # aws sts get-caller-identity",
    "'kubectl get pods'", "sh -c 'kubectl --context prod get pods'",
    "bash -lc 'aws --profile prod sts get-caller-identity'", "mosh host -- aws sts get-caller-identity",
    "k get pods", "tf plan", "make terraform", "npm run docker", "watch kubectl get pods",
    "command -v aws", "env -S 'aws --profile prod sts get-caller-identity'",
    "sudo -i aws sts get-caller-identity",
  ])("does not infer executable tools from aliases, text, or payloads: %s", (command) => {
    expect(detectStatusToolSignals(command)).toEqual([]);
  });

  it("reports SSH as the outer invocation without parsing its remote command", () => {
    for (const command of ["ssh prod 'docker ps'", "ssh prod kubectl --context prod get pods"]) {
      expect(onlySignal(command)).toMatchObject({ tool: "ssh", override: { kind: "host", value: "prod" } });
    }
  });

  it.each([
    "echo $(aws --profile prod sts get-caller-identity)",
    "echo `kubectl get pods`", "cat <<EOF\naws --profile prod sts get-caller-identity\nEOF",
    "if true; then echo ok; kubectl get pods; fi",
    "for x in 1; do echo ok; aws sts get-caller-identity; done",
    "(kubectl get pods)", "kubectl get pods > /tmp/pods", "kubectl get pods &",
    "kubectl --context 'unterminated", "kubectl get pods \\",
  ])("fails closed on unsupported or incomplete shell syntax: %s", (command) => {
    expect(detectStatusToolSignals(command)).toEqual([]);
  });

  it("recognises simple compound command segments, not their quoted payloads", () => {
    const signals = detectStatusToolSignals("cd infra && kubectl get pods | head; printf 'aws'; docker ps");
    expect(signals.map((signal) => signal.tool)).toEqual(["kubernetes", "docker"]);
    expect(signals[0].args).toEqual(["get", "pods"]);
    expect(detectStatusToolSignals("echo 'a; aws sts get-caller-identity'\nterraform plan").map((signal) => signal.tool))
      .toEqual(["terraform"]);
  });

  it("supports known wrappers and command-local assignments", () => {
    expect(onlySignal("AWS_PROFILE=prod env command -- /usr/bin/aws sts get-caller-identity"))
      .toMatchObject({
        executable: "aws",
        args: ["sts", "get-caller-identity"],
        override: { kind: "profile", value: "prod", provenance: "command override" },
      });
    expect(onlySignal("sudo -n -u deploy env DOCKER_CONTEXT=staging docker ps").override?.value).toBe("staging");
    expect(onlySignal("command -p kubectl get pods").tool).toBe("kubernetes");
  });

  it("does not carry environment assignments through sudo or env resets", () => {
    expect(onlySignal("AWS_PROFILE=prod sudo aws sts get-caller-identity").override).toBeNull();
    expect(onlySignal("AWS_PROFILE=prod sudo -E aws sts get-caller-identity").override).toBeNull();
    expect(onlySignal("AWS_PROFILE=prod env -i aws sts get-caller-identity").override).toBeNull();
    expect(onlySignal("AWS_PROFILE=prod env -u AWS_PROFILE aws sts get-caller-identity").override).toBeNull();
    expect(onlySignal("AWS_PROFILE=prod env --unset=AWS_PROFILE aws sts get-caller-identity").override).toBeNull();
    expect(onlySignal("AWS_PROFILE=prod env -i AWS_PROFILE=dev aws sts get-caller-identity").override?.value).toBe("dev");
  });

  it.each([
    ["kubectl --context prod get pods", "context", "prod"],
    ["kubectl get pods --context='staging-us'", "context", "staging-us"],
    ["helm --kube-context production list", "context", "production"],
    ["HELM_KUBECONTEXT=dev helm list", "context", "dev"],
    ["aws --profile company-prod sts get-caller-identity", "profile", "company-prod"],
    ["aws sts get-caller-identity --profile=company-dev", "profile", "company-dev"],
    ["AWS_PROFILE=dev aws sts get-caller-identity", "profile", "dev"],
    ["AWS_DEFAULT_PROFILE=staging aws sts get-caller-identity", "profile", "staging"],
    ["docker --context desktop-linux ps", "context", "desktop-linux"],
    ["docker -c production ps", "context", "production"],
    ["DOCKER_CONTEXT=dev docker ps", "context", "dev"],
    ["TF_WORKSPACE=prod terraform plan", "workspace", "prod"],
  ])("reports only literal command-bound overrides: %s", (command, kind, value) => {
    expect(onlySignal(command).override).toEqual({ kind, value, provenance: "command override" });
  });

  it("gives explicit flags priority and keeps only the last literal flag", () => {
    expect(onlySignal("AWS_PROFILE=dev aws --profile staging sts get-caller-identity --profile prod").override?.value)
      .toBe("prod");
    expect(onlySignal("AWS_DEFAULT_PROFILE=prod AWS_PROFILE=dev aws sts get-caller-identity").override?.value).toBe("dev");
    expect(onlySignal("DOCKER_CONTEXT=prod docker --context dev ps").override?.value).toBe("dev");
  });

  it.each([
    "aws --profile $PROFILE sts get-caller-identity",
    'aws --profile "${PROFILE}" sts get-caller-identity',
    "AWS_PROFILE=$PROFILE aws sts get-caller-identity",
    "AWS_DEFAULT_PROFILE=prod AWS_PROFILE=$PROFILE aws sts get-caller-identity",
    "AWS_PROFILE=prod aws --profile $PROFILE sts get-caller-identity",
    "AWS_PROFILE=prod aws --profile '' sts get-caller-identity",
    "aws --profile prod $AWS_FLAGS sts get-caller-identity",
    "kubectl --context prod get pods $OPTIONS", "docker --context '*' ps",
    "TF_WORKSPACE=$WORKSPACE terraform plan", "aws --profile sts --profile",
  ])("keeps a tool relevant but refuses to guess expanded or invalid overrides: %s", (command) => {
    expect(onlySignal(command).override).toBeNull();
  });

  it("does not read another option's data or nested command flags as a target", () => {
    expect(onlySignal("aws ssm send-command --parameters '--profile=prod'").override).toBeNull();
    expect(onlySignal("kubectl create configmap demo --from-literal '--context=prod'").override).toBeNull();
    expect(onlySignal("kubectl exec pod -- aws --profile prod sts get-caller-identity").override).toBeNull();
    expect(onlySignal("kubectl exec pod echo --context prod").override).toBeNull();
    expect(onlySignal("docker run alpine echo --context prod").override).toBeNull();
    expect(onlySignal("docker --context dev run alpine echo --context prod").override?.value).toBe("dev");
    expect(onlySignal("kubectl --context dev exec pod -- echo --context prod").override?.value).toBe("dev");
    expect(onlySignal("aws sts get-caller-identity -- --profile prod").override).toBeNull();
  });

  it("never treats a config-switch request as proof of a changed target", () => {
    for (const command of [
      "kubectl config use-context prod", "docker context use prod",
      "terraform workspace select prod", "aws configure set profile prod",
    ]) {
      expect(onlySignal(command).override).toBeNull();
    }
    expect(onlySignal("TF_WORKSPACE=dev terraform workspace select prod").override?.value).toBe("dev");
  });

  it("does not persist previous assignments or borrow related provider contexts", () => {
    expect(onlySignal("AWS_PROFILE=prod aws sts get-caller-identity").override?.value).toBe("prod");
    expect(onlySignal("aws sts get-caller-identity").override).toBeNull();
    expect(onlySignal("AWS_PROFILE=prod terraform plan")).toMatchObject({ tool: "terraform", override: null });
    expect(onlySignal("KUBECONFIG=/tmp/prod.yaml kubectl get pods").override).toBeNull();
    expect(onlySignal("DOCKER_HOST=ssh://prod docker ps").override).toBeNull();
  });
});

describe("generic terminal command activity", () => {
  it.each([
    ["doctl account get", "doctl", "DigitalOcean"],
    ["gsutil ls", "gsutil", "Google Cloud Storage"],
    ["nerdctl ps", "nerdctl", "nerdctl"],
    ["tofu plan", "tofu", "OpenTofu"],
    ["ansible-playbook deploy.yml", "ansible-playbook", "Ansible Playbook"],
    ["psql --dbname development", "psql", "PostgreSQL"],
    ["npm run check", "npm", "npm"],
    ["gh pr list", "gh", "GitHub CLI"],
    ["my-company-cli status", "my-company-cli", "my-company-cli"],
    ["./scripts/check-environment.sh", "check-environment.sh", "check-environment.sh"],
    ["/opt/homebrew/bin/node --version", "node", "Node.js"],
    ["mosh host -- psql", "mosh", "Mosh"],
  ])("identifies direct executable activity without inferring a target: %s", (command, executable, label) => {
    expect(detectCommandToolActivities(command)).toEqual([{ id: `cli:${executable}`, label, executable }]);
  });

  it("supports only the existing understood wrappers and literal executable names", () => {
    expect(detectCommandToolActivities("CLOUD_PROFILE=$PROFILE env -i command -p -- /usr/bin/doctl account get"))
      .toEqual([{ id: "cli:doctl", label: "DigitalOcean", executable: "doctl" }]);
    expect(detectCommandToolActivities("sudo -n -u deploy env --unset SECRET command -- tofu plan"))
      .toEqual([{ id: "cli:tofu", label: "OpenTofu", executable: "tofu" }]);
    expect(detectCommandToolActivities("'my-cli' --profile '$PROFILE'"))
      .toEqual([{ id: "cli:my-cli", label: "my-cli", executable: "my-cli" }]);
  });

  it("does not leak arguments or assignments into an activity or infer provider state", () => {
    const result = detectCommandToolActivities("TOKEN=secret my-cli login --password do-not-display --tenant customer-prod");
    expect(result).toEqual([{ id: "cli:my-cli", label: "my-cli", executable: "my-cli" }]);
    expect(JSON.stringify(result)).not.toMatch(/secret|password|customer-prod|TOKEN|login/);
    expect(detectCommandToolActivities("my-cli account show $OPTIONS")).toEqual(result);
  });

  it("deduplicates by literal executable, ordered by its last direct occurrence", () => {
    expect(detectCommandToolActivities("doctl account get && npm test; gsutil ls; /usr/bin/doctl version"))
      .toEqual([
        { id: "cli:npm", label: "npm", executable: "npm" },
        { id: "cli:gsutil", label: "Google Cloud Storage", executable: "gsutil" },
        { id: "cli:doctl", label: "DigitalOcean", executable: "doctl" },
      ]);
  });

  it("does not duplicate the richer specialized tools, even without target overrides", () => {
    const command = "kubectl get pods; helm list; docker ps; aws sts get-caller-identity; terraform plan; oci iam region list; az account show; gcloud projects list; orb list; podman ps; colima status; uv run python; python3 --version; conda info; ssh host";
    expect(detectCommandToolActivities(command)).toEqual([]);
    expect(detectStatusToolSignals(command).map(({ tool }) => tool))
      .toEqual(["kubernetes", "kubernetes", "docker", "aws", "terraform", "oci", "azure", "gcloud", "orbstack", "podman", "colima", "python", "python", "conda", "ssh"]);
  });

  it.each([
    "", " ", "echo az account show", "printf 'gcloud projects list'", "# podman ps",
    "echo hello # npm test", "cd project && pwd; ls -la | head", "true && clear",
    "git_alias=git", "alias gcp='gcloud projects list'", "export CLOUD=az",
    "command -v az", "type gcloud", "which podman", "builtin command az account show",
    "ssh prod az account show", "ssh prod 'gcloud projects list'",
    "sh -c 'az account show'", "bash -lc 'npm test'", "zsh -ic 'tofu plan'",
    "eval 'az account show'", "exec gcloud projects list", "source ./scripts/check-environment.sh",
    ". ./scripts/check-environment.sh", "watch podman ps", "timeout 5 az account show",
    "env -S 'az account show'", "sudo -i az account show", 'sudo -u "$USER" az account show',
    "xargs az account show", "time az account show", "su -c 'psql' user",
  ])("omits housekeeping, shell builtins, payloads, and unknown wrappers: %s", (command) => {
    expect(detectCommandToolActivities(command)).toEqual([]);
  });

  it("reports a runner or an alias spelling only as itself, not its arguments or expansion", () => {
    expect(detectCommandToolActivities("npm run docker; python -c 'az account show'; k get pods"))
      .toEqual([
        { id: "cli:npm", label: "npm", executable: "npm" },
        { id: "cli:k", label: "k", executable: "k" },
      ]);
    expect(detectStatusToolSignals("python -c 'az account show'").map((signal) => signal.tool)).toEqual(["python"]);
  });

  it.each([
    "$CLI list", '"${CLI}" list', "./$CLI list", "./tools/* status", "~/bin/az account show",
    "echo $(az account show)", "echo `gcloud projects list`", "psql < setup.sql",
    "cat <<EOF\naz account show\nEOF", "if true; then az account show; fi",
    "for x in a; do npm test; done", "(tofu plan)", "az account show &",
    "az account show > result.json", "az 'unterminated", "az account show \\",
    "'my cli' status", "'bad\u0000cli' status", "'bad\u001bcli' status", "-az account show",
  ])("fails closed for dynamic executables or unsupported shell syntax: %s", (command) => {
    expect(detectCommandToolActivities(command)).toEqual([]);
  });

  it("bounds both parsed input and executable names", () => {
    expect(detectCommandToolActivities(`az ${"x".repeat(16_384)}`)).toEqual([]);
    expect(detectCommandToolActivities(`${"x".repeat(65)} status`)).toEqual([]);
    expect(detectCommandToolActivities(`${"x".repeat(64)} status`)).toHaveLength(1);
  });

  it.each([
    "cli:az", "cli:my-cli", "cli:check-environment.sh", "cli:ABC_2+tool", `cli:${"x".repeat(64)}`,
  ])("accepts bounded basename preference IDs: %s", (value) => {
    expect(isCommandToolId(value)).toBe(true);
  });

  it.each([
    undefined, null, false, 123, {}, [], "", "az", "cli:", "CLI:az", "cli:../az", "cli:/usr/bin/az",
    "cli:az.exe/other", "cli:C:\\az", "cli:az login", "cli:az\n", "cli:az\u0000", "cli:az\u001b",
    "cli:<script>", "cli:az;echo", "cli:$CLI", "cli:-az", "cli:.hidden", `cli:${"x".repeat(65)}`,
  ])("rejects unsafe, noncanonical, or oversized preference IDs: %s", (value) => {
    expect(isCommandToolId(value)).toBe(false);
  });

  it("uses literal fallback labels without inherited object properties", () => {
    expect(commandToolLabel("cli:constructor")).toBe("constructor");
    expect(commandToolLabel("cli:toString")).toBe("toString");
    expect(commandToolLabel("cli:Azure-Helper")).toBe("Azure-Helper");
  });
});

describe("status integration catalog and parser interface", () => {
  it("catalogs rich tools and useful generic tools without duplicate IDs", () => {
    const ids = STATUS_TOOL_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tool of STATUS_TOOLS) {
      expect(STATUS_TOOL_CATALOG.find((entry) => entry.id === tool)).toMatchObject({
        label: STATUS_TOOL_LABELS[tool], executables: expect.any(Array),
      });
    }
    expect(STATUS_TOOL_CATALOG).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "oci", category: "cloud", executables: ["oci"] }),
      expect.objectContaining({ id: "orbstack", category: "containers", executables: ["orb", "orbctl"] }),
      expect.objectContaining({ id: "python", category: "development", executables: ["uv", "python", "python3"] }),
      expect.objectContaining({ id: "ssh", category: "connections" }),
      expect.objectContaining({ id: "cli:psql", category: "databases" }),
      expect.objectContaining({ id: "cli:node", label: "Node.js" }),
      expect.objectContaining({ id: "cli:tailscale", category: "connections" }),
    ]));
  });

  it.each([
    ["cli:az", "azure"], ["cli:oci", "oci"], ["cli:gcloud", "gcloud"],
    ["cli:orb", "orbstack"], ["cli:orbctl", "orbstack"], ["cli:podman", "podman"],
    ["cli:colima", "colima"], ["cli:uv", "python"], ["cli:python3", "python"],
    ["cli:conda", "conda"], ["cli:ssh", "ssh"], ["cli:helm", "kubernetes"],
    ["aws", "aws"], ["cli:my-cli", "cli:my-cli"], ["cli:constructor", "cli:constructor"],
  ] as const)("canonicalizes stored integration ID %s", (id, expected) => {
    expect(canonicalStatusToolId(id)).toBe(expected);
  });

  it("exports token provenance without expanding or executing shell values", () => {
    const invocation = statusCommandInvocations('env -i PROFILE="$PROFILE" command -- /opt/bin/oci --profile dev')?.[0];
    expect(invocation).toMatchObject({ executable: "oci", program: "/opt/bin/oci", args: [
      { value: "--profile", dynamic: false }, { value: "dev", dynamic: false },
    ] });
    expect(invocation?.env.get("PROFILE")).toEqual({ value: "$PROFILE", dynamic: true });
    expect(statusCommandInvocations("echo $(oci iam region list)")).toBeNull();
    expect(statusCommandInvocations("sudo -i oci iam region list")).toEqual([]);
  });

  it("exports bounded literal values and backward-compatible override lists", () => {
    expect(literalStatusValue({ value: "team-prod", dynamic: false })).toBe("team-prod");
    expect(literalStatusValue({ value: "$PROFILE", dynamic: true })).toBeNull();
    expect(literalStatusValue({ value: "<script>", dynamic: false })).toBeNull();
    expect(literalStatusValue({ value: "x".repeat(161), dynamic: false })).toBeNull();
    const signal = onlySignal("aws --profile dev sts get-caller-identity");
    const { overrides: _overrides, ...legacy } = signal;
    expect(statusToolOverrides(legacy)).toEqual([signal.override]);
    expect(statusToolOverrides(onlySignal("docker ps"))).toEqual([]);
  });
});
