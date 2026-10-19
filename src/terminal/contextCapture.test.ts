import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { CONTEXT_OSC, MAX_TERMINAL_CONTEXT_BYTES, parseContextOsc, TerminalContextCapture, type ContextCaptureScope } from "./contextCapture";
import { KubeconfigOutputFilter } from "./kubeconfigCapture";

const prefix = "husk;context;1;";
const defaults = { kubeconfig: null, defaultKubeconfigPath: "/fixture/home/.kube/config", dockerConfig: "/fixture/home/.docker", dockerContext: null, dockerHost: false };
const scope: ContextCaptureScope = { leafId: 2, ptyId: 44, cwd: "/fixture/workspace", generation: 7, remoteHost: null, active: true, ready: { ready: true } };
const record = (values = ["", defaults.defaultKubeconfigPath, defaults.dockerConfig, "", "0"]) => prefix + values.map(encodeURIComponent).join(";");
function readyCapture() {
  const capture = new TerminalContextCapture();
  capture.observe(record(), scope.generation, scope.cwd, 123);
  capture.completePrompt();
  return capture;
}

describe("bounded terminal context metadata", () => {
  it("uses a distinct private OSC and captures only selected metadata", () => {
    expect(CONTEXT_OSC).toBe(781);
    expect(parseContextOsc(record())).toEqual(defaults);
    expect(parseContextOsc(record(["./日本.yaml:/tmp/kube;2", "", "./docker cfg", "staging", "1"]))).toEqual({ kubeconfig: "./日本.yaml:/tmp/kube;2", defaultKubeconfigPath: null, dockerConfig: "./docker cfg", dockerContext: "staging", dockerHost: true });
  });
  it("does not infer missing exported home, defaults or context names", () => {
    expect(parseContextOsc(record(["", "", "", "", "0"]))).toEqual({ kubeconfig: null, defaultKubeconfigPath: null, dockerConfig: null, dockerContext: null, dockerHost: false });
  });
  it.each(["/fixture/home/.kube/config", "C:\\fixture\\.kube\\config", "\\\\server\\share\\config"])("accepts absolute exported default %s", (path) => {
    expect(parseContextOsc(record(["", path, "", "", "0"]))?.defaultKubeconfigPath).toBe(path);
  });
  it("rejects unsupported versions, malformed encoding, extra fields and contradictory paths", () => {
    for (const value of ["", prefix + "unavailable", record().replace(";1;", ";2;"), prefix + "%ZZ;;;;0", prefix + "%FF;;;;0", record() + ";extra", record(["file", "/default", "", "", "0"]), record(["", "relative", "", "", "0"]), record(["", "C:relative", "", "", "0"]), record(["", "", "", "", "yes"])]) expect(parseContextOsc(value)).toBeNull();
  });
  it("rejects controls in every field and overlong UTF-8 metadata", () => {
    for (let index = 0; index < 4; index++) {
      for (const control of ["\0", "\n", "\r", "\x1b", "\x7f", "\x85"]) {
        const values = ["", "", "", "", "0"];
        values[index] = "/path" + control;
        expect(parseContextOsc(record(values))).toBeNull();
      }
    }
    expect(parseContextOsc(record(["é".repeat(4097), "", "", "", "0"]))).toBeNull();
    expect(parseContextOsc(record(["", "", "", "x".repeat(1025), "0"]))).toBeNull();
    expect(parseContextOsc(prefix + "x".repeat(MAX_TERMINAL_CONTEXT_BYTES * 3 + 6))).toBeNull();
  });
  it("requires complete prompt and pins terminal, cwd, generation and capture time", () => {
    const capture = new TerminalContextCapture();
    capture.observe(record(), scope.generation, scope.cwd, 123);
    expect(capture.snapshot(scope).available).toBe(false);
    capture.completePrompt();
    expect(capture.snapshot(scope)).toEqual({ available: true, leafId: 2, ptyId: 44, cwd: scope.cwd, capturedAt: 123, ...defaults });
  });
  it.each([{ active: false }, { ptyId: null }, { remoteHost: "ssh.example" }, { remoteHost: undefined }, { generation: 8 }, { cwd: "/different" }, { cwd: "" }, { ready: { ready: false as const, reason: "Busy" } }])("rejects unavailable/remote/busy/changed scope %j", (change) => {
    expect(readyCapture().snapshot({ ...scope, ...change }).available).toBe(false);
  });
  it("never reuses stale metadata after command execution or malformed replacement", () => {
    const capture = readyCapture();
    capture.invalidate(); capture.completePrompt();
    expect(capture.snapshot(scope).available).toBe(false);
    capture.observe(record(), scope.generation, scope.cwd); capture.completePrompt();
    capture.observe(prefix + "unavailable", scope.generation, scope.cwd); capture.completePrompt();
    expect(capture.snapshot(scope).available).toBe(false);
  });
  it.each(["\x1b]781;", "\x9d781;"])("strips private context metadata at every chunk boundary for %j", (osc) => {
    for (const end of ["\x1b\\", "\x07", "\x9c"]) {
      const value = "before" + osc + record() + end + "after\x1b]133;B\x1b\\";
      for (let split = 0; split <= value.length; split++) {
        const filter = new KubeconfigOutputFilter();
        expect(filter.consume(value.slice(0, split)) + filter.consume(value.slice(split))).toBe("beforeafter\x1b]133;B\x1b\\");
      }
    }
  });
  it("discards overlong and malformed payloads without leaking content", () => {
    const filter = new KubeconfigOutputFilter();
    expect(filter.consume("a\x1b]781;broken;")).toBe("a");
    expect(filter.consume("private".repeat(50_000))).toBe("");
    expect(filter.consume("\x1b\\ok")).toBe("ok");
  });
});

describe.each([{ shell: "/bin/zsh", file: "zshrc.zsh", args: ["-f"] }, { shell: "/bin/bash", file: "bashrc.bash", args: ["--noprofile", "--norc"] }])("$shell isolated context emission", ({ shell, file, args }) => {
  const source = readFileSync(new URL(`../../src-tauri/src/scripts/${file}`, import.meta.url), "utf8");
  // Extract pure helpers only. Never source user rc, inherit secrets or read config.
  const helpers = ["_husk_urlencode", "__husk_report_context"].map((name) => {
    const match = source.match(new RegExp(`^  ${name}\\(\\) \\{[\\s\\S]*?^  \\}`, "m"));
    if (!match) throw new Error(`Missing helper ${name}`);
    return match[0];
  }).join("\n");
  const run = (setup: string) => execFileSync(shell, [...args, "-c", helpers + "\n" + setup], { env: { PATH: "/usr/bin:/bin", LC_ALL: "C", HOME: "/fixture/home" }, encoding: "utf8", timeout: 4_000 });
  const output = (setup: string) => run(setup + "\n__husk_report_context");
  const metadata = (text: string) => parseContextOsc(text.match(/\x1b\]781;([^\x1b]*)\x1b\\/)?.[1] ?? "");
  const report = (setup: string) => metadata(output(setup));
  it.skipIf(!existsSync(shell))("uses defaults for unset, unexported and explicitly empty values", () => {
    expect(report("unset KUBECONFIG DOCKER_CONFIG DOCKER_CONTEXT DOCKER_HOST")).toEqual(defaults);
    expect(report("KUBECONFIG=/not/exported; DOCKER_CONFIG=/not/exported; DOCKER_CONTEXT=private; DOCKER_HOST=secret")).toEqual(defaults);
    expect(report("export KUBECONFIG='' DOCKER_CONFIG='' DOCKER_CONTEXT='' DOCKER_HOST='' ")).toEqual(defaults);
  });
  it.skipIf(!existsSync(shell))("captures exported selectors literally without executing strings", () => {
    expect(report("export KUBECONFIG='./日本.yaml:/config;2'; export DOCKER_CONFIG='./docker config'; export DOCKER_CONTEXT='$(not-a-command)'")).toEqual({ kubeconfig: "./日本.yaml:/config;2", defaultKubeconfigPath: null, dockerConfig: "./docker config", dockerContext: "$(not-a-command)", dockerHost: false });
  });
  it.skipIf(!existsSync(shell))("never emits Docker host URLs or unrelated credentials", () => {
    const text = output("export DOCKER_HOST='tcp://user:private-password@private-host:2376'; export AWS_SECRET_ACCESS_KEY=private-token");
    expect(text).not.toMatch(/private|tcp|2376|AWS/);
    expect(metadata(text)).toEqual({ ...defaults, dockerHost: true });
  });
  it.skipIf(!existsSync(shell))("never falls back to app HOME or unexported HOME", () => {
    const absent = { ...defaults, defaultKubeconfigPath: null, dockerConfig: null };
    expect(report("unset HOME; set -u")).toEqual(absent);
    expect(report("HOME=/unexported; typeset +x HOME")).toEqual(absent);
    expect(report("export HOME=relative")).toEqual(absent);
    expect(report("export HOME=/")).toEqual({ ...defaults, defaultKubeconfigPath: "/.kube/config", dockerConfig: "/.docker" });
  });
  it.skipIf(!existsSync(shell))("rejects SSH contexts, controls and oversized values", () => {
    expect(report("export SSH_CONNECTION=fixture; export DOCKER_CONTEXT=remote")).toBeNull();
    expect(report("export DOCKER_CONTEXT=$'context\\n'")).toBeNull();
    expect(report("export DOCKER_CONTEXT='" + "x".repeat(1025) + "'")).toBeNull();
  });
  it.skipIf(!existsSync(shell))("preserves previous status for prompt consumers", () => {
    expect(run("false; __husk_report_context; printf '\\nstatus=%s' \"$?\"")).toContain("\nstatus=1");
    expect(report("set -eu")).toEqual(defaults);
  });
  it.skipIf(!existsSync(shell))("binds relative paths to the final user-hook cwd and retains host provenance", () => {
    const text = output("export KUBECONFIG=./config; cd /tmp");
    expect(text).toMatch(/^\x1b\]7;file:\/\/[^\x1b]*\/tmp\x1b\\\x1b\]781;/);
    expect(metadata(text)?.kubeconfig).toBe("./config");
  });
  it.skipIf(!existsSync(shell) || file !== "zshrc.zsh")("captures after registered user precmd hooks without changing their order", () => {
    const registration = source.match(/    add-zsh-hook precmd _husk_precmd[\s\S]*?    add-zsh-hook preexec _husk_preexec/)?.[0];
    expect(registration).toBeTruthy();
    const text = run(`autoload -Uz add-zsh-hook\nuser_hook() { export DOCKER_CONTEXT=late-context; cd /tmp; }\n_husk_precmd() { :; }\n_husk_preexec() { :; }\nprecmd_functions=(user_hook)\n${registration}\nfor hook in $precmd_functions; do $hook; done`);
    expect(metadata(text)?.dockerContext).toBe("late-context");
    expect(text).toMatch(/\x1b\]7;file:\/\/[^\x1b]*\/tmp\x1b\\\x1b\]781;/);
  });
});

it("captures fish and PowerShell exports after user prompts and before prompt-ready", () => {
  const fish = readFileSync(new URL("../../src-tauri/src/scripts/init.fish", import.meta.url), "utf8");
  const fishPrompt = fish.match(/function fish_prompt\n([\s\S]+?)\nend/)?.[1] ?? "";
  expect(fishPrompt.indexOf("__husk_report_context")).toBeGreaterThan(fishPrompt.indexOf("        __husk_user_prompt\n"));
  expect(fishPrompt.indexOf("__husk_report_context")).toBeLessThan(fishPrompt.indexOf("printf '\\e]133;B"));
  const powershell = readFileSync(new URL("../../src-tauri/src/scripts/profile.ps1", import.meta.url), "utf8");
  const prompt = powershell.slice(powershell.indexOf("function global:prompt"));
  expect(prompt.indexOf("$contextMetadata = __husk_report_context")).toBeGreaterThan(prompt.indexOf("& __husk_user_prompt"));
  expect(prompt).toContain("${original}${contextMetadata}${oscB}");
});
