import { afterEach, describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { TerminalPromptTracker } from "./promptTracker";
import { absolutePromptPosition, inspectPromptReadiness, readEditablePrompt } from "./promptDraft";

const terminals: Terminal[] = [];
afterEach(() => { for (const term of terminals.splice(0)) term.dispose(); });
function setup(cols = 60, rows = 5, scrollback = 100) {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  terminals.push(term);
  const tracker = new TerminalPromptTracker(term);
  term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith("B")) tracker.capture();
    if (data.startsWith("C") || data.startsWith("D")) tracker.clear();
    return true;
  });
  return { term, tracker, write: (text: string) => new Promise<void>(resolve => term.write(text, resolve)) };
}
const B = "\x1b]133;B\x07";

describe("live prompt tracking in actual xterm buffers", () => {
  it("follows an empty prompt when earlier output reflows, without reading that output as a draft", async () => {
    const { term, tracker, write } = setup();
    await write("x".repeat(59) + "\r\n❯ " + B);
    const original = tracker.position();
    tracker.resize(20, () => term.resize(20, 5));
    expect(tracker.position()).toEqual(absolutePromptPosition(term.buffer.active));
    expect(tracker.position()?.row).not.toBe(original?.row);
    expect(readEditablePrompt(term.buffer.active, original)).not.toBe("");
    expect(readEditablePrompt(term.buffer.active, tracker.position())).toBe("");
    expect(inspectPromptReadiness(term.buffer.active, tracker.position())).toEqual({ ready: true });
    tracker.resize(60, () => term.resize(60, 5));
    expect(tracker.position()).toEqual(original);
  });

  it("follows height changes and scrollback trimming without accepting a trimmed-away prompt", async () => {
    const { term, tracker, write } = setup(20, 5, 2);
    await write("line\r\n".repeat(8) + "❯ " + B);
    for (const rows of [2, 7, 2, 5]) {
      tracker.resize(20, () => term.resize(20, rows));
      expect(tracker.position()).toEqual(absolutePromptPosition(term.buffer.active));
      expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(true);
    }
    await write("\r\nmore output".repeat(10));
    expect(tracker.position()).toBeNull();
  });

  it.each(["unfinished command", "a long command that wraps across several rows before resizing"])("does not lose protection for a draft during resize: %s", async draft => {
    const { term, tracker, write } = setup(30);
    await write("❯ " + B + draft);
    expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(false);
    tracker.resize(10, () => term.resize(10, 5));
    expect(tracker.position()).toBeNull();
    expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(false);
    await write("\r\n❯ " + B);
    expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(true);
  });

  it("rejects drafts to the right of Home, including literal spaces and suggestions", async () => {
    const { term, tracker, write } = setup();
    for (const text of ["typed command", "    ", "ghost suggestion"]) {
      await write("\r\n❯ " + B + text + `\x1b[${text.length}D`);
      expect(absolutePromptPosition(term.buffer.active)).toEqual(tracker.position());
      expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(false);
    }
  });

  it("reads drafts by terminal cells for wide and combined Unicode prompt characters", async () => {
    const { term, tracker, write } = setup();
    for (const prompt of ["界❯ ", "e\u0301❯ ", "😀❯ "]) {
      await write("\r\n" + prompt + B + "git");
      expect(readEditablePrompt(term.buffer.active, tracker.position())).toBe("git");
    }
  });

  it.each(["\x1b[2J", "\x1b[2K", "\x1bc"])("invalidates erased/reset prompts without guessing a new position: %j", async sequence => {
    const { tracker, write } = setup();
    await write("❯ " + B);
    await write(sequence);
    expect(tracker.position()).toBeNull();
  });

  it("invalidates on command start/end and resumes only after a fresh prompt boundary", async () => {
    const { term, tracker, write } = setup();
    await write("❯ " + B + "false\r\n\x1b]133;C\x07");
    expect(tracker.position()).toBeNull();
    await write("\x1b]133;D;1\x07\r\n❯ ");
    expect(tracker.position()).toBeNull();
    await write(B);
    expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(true);
    expect(term.markers).toHaveLength(1);
    await write(B);
    expect(term.markers).toHaveLength(1);
    tracker.clear();
    expect(term.markers).toHaveLength(0);
  });

  it("requires a new boundary after an unexpected resize or clipped prompt column", async () => {
    const { term, tracker, write } = setup();
    await write("long prompt ❯ " + B);
    tracker.resize(5, () => term.resize(5, 5));
    expect(tracker.position()).toBeNull();
    await write("\r\n❯ " + B);
    term.resize(30, 5);
    expect(tracker.position()).toBeNull();
  });

  it("does not carry columns through a mode that reflows the active prompt itself", async () => {
    const { term, tracker, write } = setup(20);
    term.options.reflowCursorLine = true;
    await write("a long prompt ❯ " + B);
    tracker.resize(30, () => term.resize(30, 5));
    expect(tracker.position()).toBeNull();
    await write("\r\n❯ " + B);
    expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(true);
  });

  it("does not use a normal prompt inside an alternate-screen application", async () => {
    const { term, tracker, write } = setup();
    await write("❯ " + B);
    await write("\x1b[?1049h");
    expect(tracker.position()).toBeNull();
    expect(inspectPromptReadiness(term.buffer.active, tracker.position()).ready).toBe(false);
  });
});
