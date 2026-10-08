import { expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { ShellCommandMarkers } from "./shellCommandMarkers";
import { TerminalPromptTracker } from "./promptTracker";
import { inspectPromptReadiness } from "./promptDraft";
import { TerminalKubeconfigCapture } from "./kubeconfigCapture";

it("deduplicates Husk/theme command boundaries without suppressing prompt redraws", () => {
  const markers = new ShellCommandMarkers();
  expect(markers.accept("B")).toBe(true);
  markers.announceCommand();
  expect(markers.accept("C")).toBe(true);
  expect(markers.accept("C;")).toBe(false);
  expect(markers.accept("D;1")).toBe(true);
  expect(markers.accept("D;1")).toBe(false);
  expect(markers.accept("A")).toBe(false);
  expect(markers.accept("B")).toBe(true);
  expect(markers.accept("B")).toBe(true);
});

it("rejects a theme's synthetic empty command after Husk has already ended the prompt cycle", () => {
  const markers = new ShellCommandMarkers();
  markers.accept("B");
  expect(markers.accept("D;0")).toBe(true);
  expect(markers.accept("C;")).toBe(false);
  expect(markers.accept("D;0")).toBe(false);
  markers.announceCommand();
  expect(markers.accept("C")).toBe(true);
  expect(markers.accept("D;0")).toBe(true);
  markers.reset();
  expect(markers.accept("C")).toBe(true);
});

it("keeps a real xterm prompt and kubeconfig metadata ready across Powerlevel10k-style duplicated marks", async () => {
  const term = new Terminal({ cols: 80, rows: 12, allowProposedApi: true });
  const markers = new ShellCommandMarkers();
  const prompt = new TerminalPromptTracker(term);
  const config = new TerminalKubeconfigCapture();
  const accepted: string[] = [];
  term.parser.registerOscHandler(133, data => {
    if (!markers.accept(data)) return true;
    accepted.push(data[0]);
    if (data[0] === "B") { prompt.capture(); config.completePrompt(); }
    else { prompt.clear(); config.invalidate(); }
    return true;
  });
  term.parser.registerOscHandler(779, data => { config.observe(data, 1, "/project"); return true; });
  const write = (data: string) => new Promise<void>(resolve => term.write(data, resolve));
  const metadata = "\x1b]779;husk;kubeconfig;1;value;/private/config\x1b\\";
  const paintedPrompt = "\r\x1b[0m\x1b[J~/project main\r\n\x1b[35m❯\x1b[39m \x1b]133;B\x07\x1b[K\x1b[?2004h";
  try {
    markers.announceCommand();
    await write("\x1b]133;C\x1b\\\x1b]133;C;\x07failure output\r\n\x1b]133;D;1\x1b\\" + metadata + "\x1b]133;D;1\x07" + paintedPrompt);
    expect(accepted).toEqual(["C", "D", "B"]);
    const ready = inspectPromptReadiness(term.buffer.active, prompt.position());
    expect(ready).toEqual({ ready: true });
    expect(config.snapshot({ leafId: 1, ptyId: 2, cwd: "/project", generation: 1, remoteHost: null, active: true, ready })).toMatchObject({ available: true, kubeconfig: "/private/config" });
    await write("\r\n\x1b]133;D;0\x1b\\" + metadata + "\x1b]133;C;\x07\x1b]133;D;0\x07" + paintedPrompt);
    expect(accepted).toEqual(["C", "D", "B", "D", "B"]);
    expect(inspectPromptReadiness(term.buffer.active, prompt.position()).ready).toBe(true);
    await write("draft\x1b[5D");
    expect(inspectPromptReadiness(term.buffer.active, prompt.position())).toMatchObject({ ready: false, code: "input-present" });
  } finally { prompt.clear(); term.dispose(); }
});
