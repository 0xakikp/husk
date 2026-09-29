import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { KubeconfigOutputFilter, MAX_TERMINAL_KUBECONFIG_BYTES, TerminalKubeconfigCapture, parseKubeconfigOsc, type KubeconfigCaptureScope } from "./kubeconfigCapture";

const prefix = "husk;kubeconfig;1;";
const defaultPath = "/fixture/home/.kube/config";
const defaultValue = { kubeconfig: null, defaultKubeconfigPath: defaultPath };
const scope: KubeconfigCaptureScope = { leafId: 1, ptyId: 42, cwd: "/workspace", generation: 3, remoteHost: null, active: true, ready: { ready: true } };
function readyCapture(value = "value;%2Ftmp%2Fstaging.yaml"): TerminalKubeconfigCapture {
  const capture = new TerminalKubeconfigCapture();
  capture.observe(prefix + value, scope.generation, scope.cwd, 123);
  capture.completePrompt();
  return capture;
}

describe("bounded terminal kubeconfig metadata", () => {
  it("preserves paths, relative paths, Unicode, spaces and path-list separators without evaluating them", () => {
    const value = "/tmp/my cluster/日本.yaml:./other.yaml:$(not-a-command)";
    expect(parseKubeconfigOsc(prefix + "value;" + encodeURIComponent(value))).toEqual({ kubeconfig: value, defaultKubeconfigPath: null });
  });
  it("distinguishes a known default from missing, unsupported or malformed metadata", () => {
    expect(parseKubeconfigOsc(prefix + "unset;" + encodeURIComponent(defaultPath))).toEqual(defaultValue);
    for (const data of ["", prefix + "unset", prefix + "value;", prefix + "unavailable", "husk;kubeconfig;2;unset", prefix + "value;%ZZ", prefix + "value;%FF", prefix + "unset;extra"]) {
      expect(parseKubeconfigOsc(data)).toBeNull();
    }
  });
  it("rejects control characters and oversized UTF-8 values", () => {
    for (const value of ["/tmp/a\n", "/tmp/\x1bfile", "/tmp/\x00file", "/tmp/\x85file", "é".repeat(MAX_TERMINAL_KUBECONFIG_BYTES / 2 + 1)]) {
      expect(parseKubeconfigOsc(prefix + "value;" + encodeURIComponent(value))).toBeNull();
    }
  });
  it("requires a completed prompt and pins the exact terminal, cwd and capture timestamp", () => {
    const capture = new TerminalKubeconfigCapture();
    capture.observe(prefix + "unset;" + encodeURIComponent(defaultPath), scope.generation, scope.cwd, 123);
    expect(capture.snapshot(scope).available).toBe(false);
    capture.completePrompt();
    expect(capture.snapshot(scope)).toEqual({ available: true, leafId: 1, ptyId: 42, cwd: "/workspace", ...defaultValue, capturedAt: 123 });
  });
  it.each([
    { active: false }, { ptyId: null }, { remoteHost: "ssh.example" }, { remoteHost: undefined },
    { generation: 4 }, { cwd: "/another" }, { ready: { ready: false as const, reason: "Busy" } },
  ])("rejects unavailable, remote, busy or changed scope: %j", (change) => {
    expect(readyCapture().snapshot({ ...scope, ...change }).available).toBe(false);
  });
  it("invalidates on command start and malformed replacement instead of reusing an older config", () => {
    const capture = readyCapture();
    capture.invalidate(); capture.completePrompt();
    expect(capture.snapshot(scope).available).toBe(false);
    capture.observe(prefix + "unavailable", scope.generation, scope.cwd); capture.completePrompt();
    expect(capture.snapshot(scope).available).toBe(false);
  });
});

describe("private metadata output filtering", () => {
  it("removes records at every possible chunk boundary while preserving other OSC and output", () => {
    const input = "before\x1b]779;" + prefix + "value;%2Fprivate%2Fconfig\x1b\\after\x1b]133;B\x1b\\";
    for (let split = 0; split <= input.length; split++) {
      const filter = new KubeconfigOutputFilter();
      expect(filter.consume(input.slice(0, split)) + filter.consume(input.slice(split))).toBe("beforeafter\x1b]133;B\x1b\\");
    }
  });
  it("recognizes BEL and C1 terminators without leaking payloads to logs", () => {
    const filter = new KubeconfigOutputFilter();
    expect(filter.consume("a\x9d779;" + prefix + "unset\x9cb\x1b]779;" + prefix + "unset\x07c")).toBe("abc");
  });
  it("discards malformed and overlong metadata without storing its payload", () => {
    const filter = new KubeconfigOutputFilter();
    expect(filter.consume("\x1b]779;broken;")).toBe("");
    expect(filter.consume("private".repeat(50_000))).toBe("");
    expect(filter.consume("\x1b\\visible")).toBe("visible");
  });
});

describe.each([{ shell: "/bin/zsh", file: "zshrc.zsh", args: ["-f"] }, { shell: "/bin/bash", file: "bashrc.bash", args: ["--noprofile", "--norc"] }])("$shell prompt metadata", ({ shell, file, args }) => {
  // Extract only our two pure functions. Never source the user's shell config,
  // run the complete integration file, or inherit real credentials/environment.
  const source = readFileSync(new URL(`../../src-tauri/src/scripts/${file}`, import.meta.url), "utf8");
  const helpers = ["_husk_urlencode", "__husk_report_kubeconfig"].map((name) => {
    const match = source.match(new RegExp(`^  ${name}\\(\\) \\{[\\s\\S]*?^  \\}`, "m"));
    if (!match) throw new Error(`Missing ${name} helper`);
    return match[0];
  }).join("\n");
  function runIsolated(setup: string): string {
    return execFileSync(shell, [...args, "-c", helpers + "\n" + setup], {
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", HOME: "/fixture/home" }, encoding: "utf8", timeout: 3_000,
    });
  }
  function report(setup: string): ReturnType<typeof parseKubeconfigOsc> {
    const output = runIsolated(setup + "\n__husk_report_kubeconfig");
    return parseKubeconfigOsc(output.replace(/^\x1b\]779;/, "").replace(/\x1b\\$/, ""));
  }
  it.skipIf(!existsSync(shell))("observes unset and shell-only variables as default", () => {
    expect(report("unset KUBECONFIG")).toEqual(defaultValue);
    expect(report("KUBECONFIG='/tmp/unexported.yaml'")).toEqual(defaultValue);
  });
  it.skipIf(!existsSync(shell))("reports an exported value and explicit empty without shell evaluation", () => {
    expect(report("export KUBECONFIG='/tmp/my config.yaml:./日本.yaml:$(touch nothing)'")).toEqual({ kubeconfig: "/tmp/my config.yaml:./日本.yaml:$(touch nothing)", defaultKubeconfigPath: null });
    expect(report("export KUBECONFIG='' ")).toEqual(defaultValue);
  });
  it.skipIf(!existsSync(shell))("does not infer app home when terminal home is unavailable", () => {
    expect(report("unset HOME KUBECONFIG")).toBeNull();
    expect(report("export HOME=relative; unset KUBECONFIG")).toBeNull();
    expect(report("HOME='/not-exported'; typeset +x HOME; unset KUBECONFIG")).toBeNull();
  });
  it.skipIf(!existsSync(shell))("captures a changed exported home without reading it", () => {
    expect(report("export HOME='/different fixture/home/'; unset KUBECONFIG")).toEqual({ kubeconfig: null, defaultKubeconfigPath: "/different fixture/home/.kube/config" });
  });
  it.skipIf(!existsSync(shell))("preserves startup when nounset is enabled and metadata variables are absent", () => {
    expect(report("unset KUBECONFIG; set -u")).toEqual(defaultValue);
    expect(report("unset HOME KUBECONFIG; set -u")).toBeNull();
  });
  it.skipIf(!existsSync(shell))("does not strip control characters into a different accepted path", () => {
    expect(report("export KUBECONFIG=$'/tmp/config\\n'")).toBeNull();
  });
  it.skipIf(!existsSync(shell))("never advertises an SSH shell's path as a local kubeconfig", () => {
    expect(report("export SSH_CONNECTION='192.0.2.1 1 192.0.2.2 2'; export KUBECONFIG='/remote/config'")).toBeNull();
  });
  it.skipIf(!existsSync(shell) || file !== "bashrc.bash")("captures after user prompt hooks without changing their final status", () => {
    const assignment = source.match(/\*\) (PROMPT_COMMAND="_husk_precmd[^"\n]+") ;;/)?.[1];
    expect(assignment).toBeTruthy();
    const output = runIsolated(`_husk_precmd() { :; }\nPROMPT_COMMAND='export KUBECONFIG=/fixture/late.yaml; false'\n${assignment}\neval "$PROMPT_COMMAND"\nprintf '\\nstatus=%s' "$?"`);
    expect(output).toBe("\x1b]779;" + prefix + "value;/fixture/late.yaml\x1b\\\nstatus=1");
  });
});

it("keeps fish's new metadata capture after the user prompt and before prompt-ready", () => {
  const source = readFileSync(new URL("../../src-tauri/src/scripts/init.fish", import.meta.url), "utf8");
  for (const checkout of [source, source.replace(/\r?\n/g, "\r\n")]) {
    const prompt = checkout.replace(/\r\n/g, "\n").match(/function fish_prompt\n([\s\S]+?)\nend/)?.[1] ?? "";
    expect(prompt.indexOf("__husk_report_kubeconfig")).toBeGreaterThan(prompt.indexOf("        __husk_user_prompt\n"));
    expect(prompt.indexOf("__husk_report_kubeconfig")).toBeLessThan(prompt.indexOf("printf '\\e]133;B"));
  }
});
