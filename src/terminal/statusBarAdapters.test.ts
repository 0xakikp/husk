import { describe, expect, it } from "vitest";
import { detectCommandToolActivities, detectStatusToolSignals, statusToolOverrides } from "./statusBarTools";

function selectors(command: string) {
  const signals = detectStatusToolSignals(command);
  expect(signals).toHaveLength(1);
  return statusToolOverrides(signals[0]).map(({ kind, value, provenance }) => {
    expect(provenance).toBe("command override");
    return [kind, value];
  });
}
const selector = (command: string) => selectors(command)[0];

describe("cloud command selectors", () => {
  it.each([
    ["oci compute instance list --profile work --region eu-frankfurt-1", [["profile", "work"], ["region", "eu-frankfurt-1"]]],
    ["oci --profile=dev iam region list", [["profile", "dev"]]],
    ["OCI_CLI_PROFILE=dev OCI_CLI_REGION=us-ashburn-1 oci iam region list", [["profile", "dev"], ["region", "us-ashburn-1"]]],
    ["OCI_CLI_PROFILE=dev OCI_CLI_REGION=us-ashburn-1 oci --region ap-mumbai-1 --profile staging iam region list", [["profile", "staging"], ["region", "ap-mumbai-1"]]],
    ["az vm list --subscription team-dev", [["subscription", "team-dev"]]],
    ["az account show --subscription='Engineering Dev'", [["subscription", "Engineering Dev"]]],
    ["az --only-show-errors vm list --subscription abc123", [["subscription", "abc123"]]],
    ["gcloud --project team-dev --configuration work compute instances list", [["project", "team-dev"], ["configuration", "work"]]],
    ["gcloud compute instances list --project=alpha --configuration=dev", [["project", "alpha"], ["configuration", "dev"]]],
    ["CLOUDSDK_CORE_PROJECT=alpha CLOUDSDK_ACTIVE_CONFIG_NAME=dev gcloud projects list", [["project", "alpha"], ["configuration", "dev"]]],
    ["CLOUDSDK_CORE_PROJECT=alpha gcloud --project beta projects list", [["project", "beta"]]],
  ])("retains only explicit command-local selectors: %s", (command, expected) => {
    expect(selectors(command as string)).toEqual(expected);
  });

  it.each([
    "oci iam region list", "az account show", "gcloud projects list",
    "oci setup config", "gcloud config set project production", "gcloud config configurations activate prod",
    "AZURE_SUBSCRIPTION_ID=prod az vm list", "AWS_PROFILE=prod oci iam region list",
    "OCI_CLI_PROFILE=prod sudo oci iam region list", "OCI_CLI_PROFILE=prod env -i oci iam region list",
    "OCI_CLI_PROFILE=prod env --unset=OCI_CLI_PROFILE oci iam region list",
  ])("does not read defaults, persist config switches, or borrow other provider state: %s", (command) => {
    expect(selectors(command)).toEqual([]);
  });

  it.each([
    "oci --profile $PROFILE iam region list", "oci --profile dev iam region list $FLAGS",
    "OCI_CLI_PROFILE=prod oci --profile '' iam region list", "oci --region eu-frankfurt-1 --profile",
    "az vm list --subscription $SUB", "az vm list --subscription '<script>'",
    "gcloud --project dev projects list $FLAGS", "gcloud --configuration '' projects list",
    "CLOUDSDK_CORE_PROJECT=prod gcloud --flags-file flags.yaml projects list",
    "gcloud --project dev --flags-file=flags.yaml projects list",
    "OCI_CLI_PROFILE=$PROFILE oci iam region list",
  ])("fails closed for expansion, invalid selectors, and external option files: %s", (command) => {
    expect(selectors(command)).toEqual([]);
  });

  it.each([
    "oci iam region list --query '--profile=prod'",
    "oci iam region list --query '--region' prod",
    "az vm list --query '--subscription=prod'",
    "az vm run-command invoke --scripts echo --subscription prod",
    "az resource update --set property --subscription prod",
    "gcloud compute ssh host --command '--project=prod'",
    "gcloud compute ssh host -- --project prod",
  ])("never interprets another option's payload as a selector: %s", (command) => {
    expect(selectors(command)).toEqual([]);
  });

  it("keeps a selector written before a payload without reading the payload", () => {
    expect(selectors("az --subscription dev vm run-command invoke --scripts echo --subscription prod"))
      .toEqual([["subscription", "dev"]]);
    expect(selectors("gcloud --project dev compute ssh host -- --project prod"))
      .toEqual([["project", "dev"]]);
  });

  it("keeps invocation selectors ephemeral and reports no authentication result", () => {
    const signal = detectStatusToolSignals("az account set --subscription dev")[0];
    expect(signal.override).toEqual({ kind: "subscription", value: "dev", provenance: "command override" });
    expect(selectors("az account show")).toEqual([]);
    expect(signal).not.toHaveProperty("authenticated");
    expect(signal).not.toHaveProperty("connected");
  });
});

describe("container and machine selectors", () => {
  it.each([
    ["podman --connection dev ps", "connection", "dev"],
    ["podman -c dev ps", "connection", "dev"],
    ["podman --connection=staging ps", "connection", "staging"],
    ["podman --log-level debug --connection staging ps", "connection", "staging"],
    ["CONTAINER_CONNECTION=dev podman ps", "connection", "dev"],
    ["CONTAINER_CONNECTION=dev podman --connection work ps", "connection", "work"],
    ["colima --profile work status", "profile", "work"],
    ["colima status --profile=work", "profile", "work"],
    ["colima -p work status", "profile", "work"],
    ["orb -m ubuntu uname -a", "machine", "ubuntu"],
    ["orb --machine=ubuntu uname -a", "machine", "ubuntu"],
    ["orbctl shell -m ubuntu", "machine", "ubuntu"],
    ["orbctl run -m ubuntu -- echo hello", "machine", "ubuntu"],
    ["orb run -u root -m ubuntu uname", "machine", "ubuntu"],
  ])("reports only the explicit selector: %s", (command, kind, value) => {
    expect(selector(command)).toEqual([kind, value]);
  });

  it.each([
    "podman ps", "colima status", "orb list", "orbctl list", "orb default ubuntu",
    "podman system connection default dev", "colima start work",
    "podman run image echo --connection prod", "podman exec image --connection prod",
    "orb echo --machine prod", "orbctl run echo --machine prod",
    "orb -t echo --machine fake", "orb -m ubuntu --unknown echo --machine fake",
    "orbctl run --unknown-option=anything echo --machine fake",
    "orb -m ubuntu --scripts echo --machine fake",
    "podman --unknown-option ps --connection fake", "podman --unknown-option=value --connection fake ps",
    "colima ssh echo --profile prod", "colima exec echo --profile prod", "colima x echo --profile prod",
    "orb -m $MACHINE uname", "orbctl run -m '' uname", "colima --profile '*' status",
    "podman --connection dev --url ssh://user:secret@host ps",
    "CONTAINER_CONNECTION=dev CONTAINER_HOST=ssh://user:secret@host podman ps",
    "CONTAINER_CONNECTION=dev env -u CONTAINER_CONNECTION podman ps",
  ])("does not infer defaults, borrowed contexts, payloads or conflicting endpoints: %s", (command) => {
    expect(selectors(command)).toEqual([]);
  });

  it("distinguishes an explicit Docker context from an OrbStack machine", () => {
    expect(detectStatusToolSignals("docker --context orbstack ps").map(({ tool }) => tool)).toEqual(["docker"]);
    expect(detectStatusToolSignals("orb -m ubuntu docker ps").map(({ tool }) => tool)).toEqual(["orbstack"]);
    expect(selectors("orb -m ubuntu docker --context production ps")).toEqual([["machine", "ubuntu"]]);
  });
});

describe("development command selectors", () => {
  it.each([
    ["uv run --python 3.13 python script.py", "runtime", "3.13"],
    ["uv run -p /opt/python/bin/python python script.py", "runtime", "/opt/python/bin/python"],
    ["UV_PYTHON=3.12 uv run python script.py", "runtime", "3.12"],
    ["UV_PYTHON=3.12 uv run --python=3.13 python script.py", "runtime", "3.13"],
    ["uv run --locked --python 3.13 python script.py", "runtime", "3.13"],
    ["uv run --python 3.13 -m module --python fake", "runtime", "3.13"],
    ["uv run --python 3.13 --script script.py --python fake", "runtime", "3.13"],
    ["uv run --with pytest --python 3.13 pytest", "runtime", "3.13"],
    ["conda run -n data python script.py", "environment", "data"],
    ["conda run --name=data -- python script.py", "environment", "data"],
    ["conda run --prefix /opt/envs/data python script.py", "environment", "/opt/envs/data"],
    ["conda run --live-stream -n data python script.py", "environment", "data"],
    ["conda run --cwd /opt/project -n data python script.py", "environment", "data"],
  ])("reads selectors before the invoked program: %s", (command, kind, value) => {
    expect(selector(command)).toEqual([kind, value]);
  });

  it.each([
    "python script.py", "python3 --version", "VIRTUAL_ENV=env python script.py",
    "uv run python script.py --python 3.13", "uv run -- python --python 3.13",
    "uv run -m module --python fake", "uv run --module module --python fake",
    "uv run --script script.py --python fake", "uv run -s script.py --python fake",
    "uv run --unknown module --python fake", "uv run --python 3.13 --unknown module --python fake",
    "uv run --unknown=value --python fake module",
    "uv run --python $PYTHON python script.py", "uv python pin 3.13",
    "uv run --with '--python=3.13' python script.py", "uv run --python '' python script.py",
    "conda activate data", "conda run python script.py -n data",
    "CONDA_DEFAULT_ENV=data conda run python script.py", "conda run -n $ENV python script.py",
    "conda run -n data -p /opt/envs/other python script.py",
    "conda run --prefix=/opt/envs/data --name=other python script.py",
    "conda run --unknown python script.py --name fake", "conda run --name real --unknown python --name fake",
  ])("does not claim an activated environment, output-derived version, or nested selector: %s", (command) => {
    expect(selectors(command)).toEqual([]);
  });
});

describe("SSH command selectors", () => {
  it.each([
    ["ssh host", [["host", "host"]]],
    ["ssh user@server.example.com", [["host", "user@server.example.com"]]],
    ["ssh -p 1243 user@host", [["host", "user@host"], ["port", "1243"]]],
    ["ssh -p1243 -tt user@host", [["host", "user@host"], ["port", "1243"]]],
    ["ssh -p 1243 -p 22 host", [["host", "host"], ["port", "1243"]]],
    ["ssh -J bastion -i /keys/id user@host", [["host", "user@host"]]],
    ["ssh -- host", [["host", "host"]]],
    ["ssh host 'oci --profile prod iam region list'", [["host", "host"]]],
    ["ssh host kubectl --context prod get pods", [["host", "host"]]],
    ["ssh host echo $REMOTE_VARIABLE", [["host", "host"]]],
  ])("shows only a literal destination request, never resolved connection state: %s", (command, expected) => {
    expect(selectors(command as string)).toEqual(expected);
  });

  it.each([
    "ssh", "ssh $HOST", "ssh -p $PORT host", "ssh -p 0 host", "ssh -p 65536 host", "ssh -p missing host",
    "ssh -G host", "ssh -V host", "ssh -O check host", "ssh -o HostName=other host", "ssh -F config host",
    "ssh -i $KEY host", "ssh ssh://user:secret@host", "ssh '[::1]'", "ssh -unknown host",
    "ssh -J", "ssh -p", "ssh --", "ssh ''",
  ])("fails closed for ambiguous flags, non-connections, dynamic destinations or credentials: %s", (command) => {
    expect(selectors(command)).toEqual([]);
  });

  it("recognizes Mosh only as an outer activity without adopting remote commands", () => {
    expect(detectStatusToolSignals("mosh host -- oci --profile prod iam region list")).toEqual([]);
    expect(detectCommandToolActivities("mosh host -- oci --profile prod iam region list"))
      .toEqual([{ id: "cli:mosh", label: "Mosh", executable: "mosh" }]);
  });
});
