import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { K8sReadScope } from "./configSource";
import { checkNamespaceAccess, getContextNamespace, isValidNamespace, NAMESPACE_ACCESS_RESOURCES } from "./namespaceAccess";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const ok = (stdout: string) => ({ stdout, stderr: "", exit_code: 0, timed_out: false, truncated: false });
const scope: K8sReadScope = {
  context: "team's context",
  config: {
    kind: "terminal", paths: ["/fixtures/team config", "/fixtures/shared"], cwd: "/fixtures/project",
    label: "Terminal snapshot", fingerprint: "team-source", missingPaths: [],
  },
};

beforeEach(() => { mockInvoke.mockReset(); });

describe("namespace validation", () => {
  it.each(["a", "team-a", "0", "12-team", "a".repeat(63)])("accepts DNS label %s", (value) => {
    expect(isValidNamespace(value)).toBe(true);
  });

  it.each(["", "_all", "Team-a", "team_a", "team.a", "-a", "a-", "a".repeat(64), " team-a", "team-a ", "team\na", "team;echo bad", "$(pwd)"])("rejects invalid namespace %s", (value) => {
    expect(isValidNamespace(value)).toBe(false);
  });
});

describe("the selected context's namespace", () => {
  it("reads only namespace metadata, pinned to context and source, without returning kubeconfig contents", async () => {
    mockInvoke.mockResolvedValue(ok("team-a\n"));
    expect(await getContextNamespace(scope)).toBe("team-a");
    expect(mockInvoke).toHaveBeenCalledWith("kubernetes_run_command", {
      args: ["config", "view", "--minify", "--output=jsonpath={.contexts[0].context.namespace}", "--context=team's context", "--request-timeout=10s"],
      kubeconfigPaths: scope.config.paths, cwd: scope.config.cwd, timeoutSecs: 10,
    });
    expect(JSON.stringify(mockInvoke.mock.calls)).not.toContain("--raw");
  });

  it("uses default only when the context namespace was successfully read as empty", async () => {
    mockInvoke.mockResolvedValue(ok(""));
    expect(await getContextNamespace("restricted")).toBe("default");
    expect(mockInvoke).toHaveBeenCalledWith("shell_run_command", expect.objectContaining({
      program: "kubectl", args: expect.arrayContaining(["--context=restricted"]),
    }));
  });

  it.each([
    [{ exit_code: 1, stderr: "context not found" }, "context not found"],
    [{ exit_code: 1 }, "Could not read"],
    [{ timed_out: true }, "timed out"],
    [{ truncated: true }, "size limit"],
    [{ stdout: "INVALID_NAMESPACE" }, "invalid namespace"],
  ])("never substitutes default for an unavailable/invalid context: %j", async (extra, message) => {
    mockInvoke.mockResolvedValue({ ...ok(""), ...extra });
    await expect(getContextNamespace(scope)).rejects.toThrow(message);
  });

  it("does not fall back to the mutable current context", async () => {
    await expect(getContextNamespace("")).rejects.toThrow("Choose a Kubernetes context");
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("explicit namespace permission checks", () => {
  it("explains missing AWS credentials executable without reporting RBAC denial", async () => {
    const stderr = "E0929 memcache.go:265] couldn't get API list: getting credentials: exec: executable aws not found\n".repeat(4);
    mockInvoke.mockResolvedValue({ ...ok("no"), stderr, exit_code: 1 });
    expect(await checkNamespaceAccess("team-a", ["pods"], scope)).toEqual([{
      resource: "pods", allowed: null, error: "AWS CLI unavailable to Husk",
      errorHint: expect.stringContaining("permissions were not checked"), diagnostics: stderr.trim(),
    }]);
  });

  it("classifies missing helper errors from a rejected command too", async () => {
    mockInvoke.mockRejectedValue("getting credentials: exec: executable gke-gcloud-auth-plugin not found");
    expect(await checkNamespaceAccess("team-a", ["pods"], scope)).toEqual([expect.objectContaining({
      allowed: null, error: "Authentication helper “gke-gcloud-auth-plugin” unavailable to Husk",
      errorHint: expect.stringContaining("permissions were not checked"),
    })]);
  });

  it("does not confuse an expired AWS session with a missing executable", async () => {
    const stderr = "getting credentials: exec: executable aws failed with exit code 255: The SSO session has expired";
    mockInvoke.mockResolvedValue({ ...ok(""), stderr, exit_code: 1 });
    expect(await checkNamespaceAccess("team-a", ["pods"], scope)).toEqual([{ resource: "pods", allowed: null, error: stderr }]);
  });

  it("checks the exact list permission in the chosen namespace with all source identity intact", async () => {
    mockInvoke.mockResolvedValue(ok("yes\n"));
    expect(await checkNamespaceAccess("team-a", ["pods", "deployments.apps", "secrets"], scope)).toEqual([
      { resource: "pods", allowed: true }, { resource: "deployments.apps", allowed: true }, { resource: "secrets", allowed: true },
    ]);
    for (const [command, payload] of mockInvoke.mock.calls) {
      expect(command).toBe("kubernetes_run_command");
      expect(payload).toMatchObject({ kubeconfigPaths: scope.config.paths, cwd: scope.config.cwd, timeoutSecs: 10 });
      const args = (payload as { args: string[] }).args;
      expect(args.slice(0, 3)).toEqual(["auth", "can-i", "list"]);
      expect(args).toEqual(expect.arrayContaining(["--namespace", "team-a", "--context=team's context", "--request-timeout=10s"]));
      expect(args).not.toContain("get");
      expect(args).not.toContain("--all-namespaces");
      expect(args).not.toContain("--as");
    }
  });

  it("keeps namespace discovery cluster-scoped and supports an explicit all-namespaces selection", async () => {
    mockInvoke.mockResolvedValue(ok("yes"));
    await checkNamespaceAccess("team-a", ["namespaces"], scope);
    await checkNamespaceAccess("_all", ["pods"], scope);
    for (const [, payload] of mockInvoke.mock.calls) {
      const args = (payload as { args: string[] }).args;
      expect(args).toContain("--all-namespaces");
      expect(args).not.toContain("--namespace");
    }
  });

  it.each([0, 1])("recognizes a clean no response with exit %s as denial", async (exit_code) => {
    mockInvoke.mockResolvedValue({ ...ok("no\n"), exit_code });
    expect(await checkNamespaceAccess("team-a", ["pods"], scope)).toEqual([{ resource: "pods", allowed: false }]);
  });

  it.each([
    [{ stdout: "no", stderr: "Unable to connect to the server", exit_code: 1 }, "Unable to connect"],
    [{ stdout: "", stderr: "Unauthorized", exit_code: 1 }, "Unauthorized"],
    [{ stdout: "no", stderr: "Forbidden: selfsubjectaccessreviews is forbidden", exit_code: 1 }, "selfsubjectaccessreviews"],
    [{ stdout: "no", timed_out: true, exit_code: 1 }, "timed out"],
    [{ stdout: "no", truncated: true, exit_code: 1 }, "size limit"],
    [{ stdout: "no - authorization webhook failed", exit_code: 1 }, "authorization webhook failed"],
    [{ stdout: "yes", exit_code: 1 }, "Could not confirm"],
    [{ stdout: "no", exit_code: 2 }, "Could not confirm"],
    [{ stdout: "yes", stderr: "Warning: resource type not found" }, "resource type not found"],
    [{ stdout: "partial" }, "Could not confirm"],
    [{ stdout: "", exit_code: null }, "Could not confirm"],
  ])("does not mistake unavailable evidence for denial or permission: %j", async (extra, error) => {
    mockInvoke.mockResolvedValue({ ...ok(""), ...extra });
    expect(await checkNamespaceAccess("team-a", ["pods"], scope)).toEqual([
      { resource: "pods", allowed: null, error: expect.stringContaining(error) },
    ]);
  });

  it("handles a rejected command independently without discarding other checks", async () => {
    mockInvoke.mockImplementation(async (_command, payload) => {
      if ((payload as { args: string[] }).args.includes("secrets")) throw new Error("kubectl unavailable");
      return ok("yes");
    });
    expect(await checkNamespaceAccess("team-a", ["pods", "secrets"], scope)).toEqual([
      { resource: "pods", allowed: true }, { resource: "secrets", allowed: null, error: "kubectl unavailable" },
    ]);
  });

  it("bounds concurrent checks, deduplicates resources, and retains the requested order", async () => {
    let active = 0;
    let maximum = 0;
    mockInvoke.mockImplementation(async () => {
      active += 1;
      maximum = Math.max(active, maximum);
      await Promise.resolve();
      active -= 1;
      return ok("yes");
    });
    const resources = ["pods", "services", "secrets", "configmaps", "jobs.batch", "pods"];
    const result = await checkNamespaceAccess("team-a", resources, scope);
    expect(maximum).toBe(3);
    expect(mockInvoke).toHaveBeenCalledTimes(5);
    expect(result.map((entry) => entry.resource)).toEqual([...new Set(resources)]);
  });

  it("rejects unsupported resources, excessive batches and invalid namespace/context before any command", async () => {
    await expect(checkNamespaceAccess("team-a", ["*"], scope)).rejects.toThrow("Unsupported");
    await expect(checkNamespaceAccess("team-a", ["pods; echo bad"], scope)).rejects.toThrow("Unsupported");
    await expect(checkNamespaceAccess("team-a", Array(NAMESPACE_ACCESS_RESOURCES.length + 1).fill("pods"), scope)).rejects.toThrow("Unsupported");
    await expect(checkNamespaceAccess("team_a", ["pods"], scope)).rejects.toThrow("valid Kubernetes namespace");
    await expect(checkNamespaceAccess("team-a", ["pods"], " ")).rejects.toThrow("Choose a Kubernetes context");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("does not probe anything when no resources were requested", async () => {
    expect(await checkNamespaceAccess("team-a", [], scope)).toEqual([]);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
