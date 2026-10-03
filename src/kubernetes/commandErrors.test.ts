import { describe, expect, it } from "vitest";
import { boundedK8sDiagnostic, kubernetesCommandError, missingCredentialHelper } from "./commandErrors";

describe("missing Kubernetes exec credential helpers", () => {
  it.each(["aws", '"aws"', "'aws'", "/opt/homebrew/bin/aws", '"C:\\Program Files\\Amazon\\AWSCLIV2\\aws.exe"'])
  ("recognizes a missing AWS executable %s", command => {
    const raw = `E0929 memcache.go:265] couldn't get API list: getting credentials: exec: executable ${command} not found\n`;
    expect(missingCredentialHelper(raw.repeat(3))).toMatchObject({ title: "AWS CLI unavailable to Husk" });
    const message = kubernetesCommandError(raw.repeat(3));
    expect(message).toContain("Authentication could not start");
    expect(message).toContain("login-shell PATH");
    expect(message).not.toContain("memcache");
    expect(message.match(/AWS CLI unavailable/g)).toHaveLength(1);
  });

  it.each(["kubelogin", "gke-gcloud-auth-plugin", "aws-iam-authenticator"])("names other missing helpers safely: %s", executable => {
    expect(missingCredentialHelper(`getting credentials: exec: executable ${executable} not found`)).toMatchObject({ executable });
    expect(kubernetesCommandError(`getting credentials: exec: executable ${executable} not found`)).toContain(`“${executable}” unavailable to Husk`);
  });

  it.each([
    "Unauthorized", "Forbidden: pods is forbidden", "The security token included in the request is expired",
    "getting credentials: exec: executable aws failed with exit code 255",
    "getting credentials: exec: executable aws: permission denied", "Unable to locate credentials",
    "config profile production could not be found", "executable aws not found",
    "exec: executable $(touch-marker) not found", 'exec: executable "aws; echo bad" not found',
    "exec: executable aws not foundry", "exec: executable ./ not found",
  ])("does not rewrite unrelated errors or unsafe names: %s", message => {
    expect(missingCredentialHelper(message)).toBeNull();
    expect(kubernetesCommandError(message)).toBe(message);
  });
});

it("bounds diagnostic rendering without allowing control bytes into the panel", () => {
  const diagnostic = boundedK8sDiagnostic(`\u0000line\r\n${"x".repeat(10000)}`);
  expect(diagnostic.startsWith("line\n")).toBe(true);
  expect(diagnostic.length).toBeLessThan(8250);
  expect(diagnostic).toContain("[Diagnostic truncated]");
  expect(diagnostic).not.toContain("\u0000");
});
