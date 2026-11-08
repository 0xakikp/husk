import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal, type IDisposable } from "@xterm/xterm";
import { installScrollbackClearPolicy } from "./scrollbackClear";

const fixtures: { term: Terminal; policy: IDisposable }[] = [];
afterEach(() => {
  for (const { term, policy } of fixtures.splice(0)) {
    policy.dispose();
    term.dispose();
  }
});

function setup(cols = 40, rows = 4, scrollback = 100) {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  const policy = installScrollbackClearPolicy(term);
  fixtures.push({ term, policy });
  const write = (text: string) => new Promise<void>(resolve => term.write(text, resolve));
  const lines = () => Array.from({ length: term.buffer.active.length }, (_, i) =>
    term.buffer.active.getLine(i)?.translateToString(true) ?? "");
  const visible = () => lines().slice(term.buffer.active.baseY).join("\n");
  return { term, policy, write, lines, visible };
}

describe("scrollback-preserving shell clears in real xterm buffers", () => {
  it.each(["\x1b[H\x1b[2J\x1b[3J", "\x1b[3J\x1b[H\x1b[2J", "\x1b[2J\x1b[H"])(
    "keeps previous pages and the current page above a clean prompt: %j", async sequence => {
      const { term, write, lines, visible } = setup();
      await write("first\r\nsecond\r\nthird\r\nfourth\r\nfifth\r\n");
      await write(sequence + "prompt> ");
      for (const line of ["first", "second", "third", "fourth", "fifth"]) expect(lines()).toContain(line);
      expect(visible().trimEnd()).toBe("prompt>");
      expect(term.buffer.active.cursorY).toBe(0);
      term.scrollToTop();
      expect(term.buffer.active.viewportY).toBe(0);
      expect(term.buffer.active.baseY).toBeGreaterThan(0);
    },
  );

  it("handles sequences split across arbitrary PTY chunks without writing input", async () => {
    const { term, write, lines } = setup();
    const input = vi.fn();
    term.onData(input);
    await write("older output\r\nrecent output");
    for (const part of ["\x1b", "[", "H\x1b[", "2", "J\x1b[3", "J", "prompt> "]) await write(part);
    expect(lines()).toContain("older output");
    expect(lines()).toContain("recent output");
    expect(input).not.toHaveBeenCalled();
  });

  it("preserves wrapped rows and their wrap metadata", async () => {
    const { term, write, lines } = setup(10);
    await write("1234567890abcdefghijKLM\r\nend");
    await write("\x1b[H\x1b[2J\x1b[3J");
    expect(lines().slice(0, 4)).toEqual(["1234567890", "abcdefghij", "KLM", "end"]);
    expect(term.buffer.active.getLine(1)?.isWrapped).toBe(true);
    expect(term.buffer.active.getLine(2)?.isWrapped).toBe(true);
    expect(term.buffer.active.getLine(3)?.isWrapped).toBe(false);
  });

  it("does not create extra blank history for repeated empty clears", async () => {
    const { term, write } = setup();
    await write("output\x1b[H\x1b[2J");
    const baseY = term.buffer.active.baseY;
    await write("\x1b[H\x1b[2J\x1b[3J".repeat(10));
    expect(term.buffer.active.baseY).toBe(baseY);
  });

  it("preserves normal scrollback while alternate-screen erases keep native behavior", async () => {
    const { term, write, lines, visible } = setup();
    await write("normal history\r\nnormal prompt");
    await write("\x1b[?1049hfirst frame\r\nsecond frame\x1b[H\x1b[2J\x1b[3Jreplacement");
    expect(term.buffer.active.type).toBe("alternate");
    expect(lines().join("\n")).not.toContain("frame");
    expect(visible()).toContain("replacement");
    expect(term.buffer.active.baseY).toBe(0);
    await write("\x1b[?1049l\x1b[H\x1b[2J\x1b[3Jnew prompt");
    expect(term.buffer.active.type).toBe("normal");
    expect(lines()).toContain("normal history");
    expect(lines()).toContain("normal prompt");
    expect(lines().join("\n")).not.toContain("replacement");
  });

  it.each(["\x1b[?1000h", "\x1b[?6h", "\x1b[2;3r"])(
    "does not put normal-buffer screen-app redraws into scrollback: %j", async mode => {
      const { term, write, lines } = setup();
      await write("first frame\r\nsecond frame");
      await write(mode + "\x1b[H\x1b[2J");
      expect(lines().join("\n")).not.toContain("frame");
      expect(term.buffer.active.baseY).toBe(0);
      await write("\x1b[?1000l\x1b[?6l\x1b[rreturned shell\x1b[H\x1b[2J\x1b[3J");
      expect(lines()).toContain("returned shell");
    },
  );

  it("does not mistake ordinary shell application-key modes for a screen app", async () => {
    const { write, lines } = setup();
    await write("\x1b[?1h\x1b=output\x1b[H\x1b[2J\x1b[3J");
    expect(lines()).toContain("output");
  });

  it("does not treat an invalid margin update as leaving a screen app", async () => {
    const { term, write, lines } = setup();
    await write("\x1b[2;3r\x1b[4;2rframe\x1b[H\x1b[2J");
    expect(lines().join("\n")).not.toContain("frame");
    expect(term.buffer.active.baseY).toBe(0);
  });

  it.each(["soft reset", "resize"])("recovers ordinary clear behavior after margin %s", async action => {
    const { term, write, lines } = setup();
    await write("\x1b[2;3r");
    if (action === "soft reset") await write("\x1b[!p");
    else term.resize(40, 5);
    await write("shell output\x1b[H\x1b[2J\x1b[3J");
    expect(lines()).toContain("shell output");
  });

  it("keeps DEC selective erase semantics and restores ordinary erase afterwards", async () => {
    const { term, write, lines } = setup();
    await write("\x1b[1\"qprotected\x1b[0\"q unprotected\x1b[H\x1b[?2J");
    expect(lines()[0]).toBe("protected");
    expect(term.buffer.active.baseY).toBe(0);
    await write("\x1b[H\x1b[2J");
    expect(lines()).toContain("protected");
    expect(term.buffer.active.baseY).toBeGreaterThan(0);
  });

  it("does not change partial viewport erasure", async () => {
    const { term, write, lines } = setup();
    await write("keep\r\nerase\x1b[2;1H\x1b[J");
    expect(lines()[0]).toBe("keep");
    expect(lines().join("\n")).not.toContain("erase");
    expect(term.buffer.active.baseY).toBe(0);
  });

  it("leaves RIS destructive and resets tracked margins", async () => {
    const { term, write, lines } = setup();
    await write("old output\r\n".repeat(10) + "\x1b[2;3r\x1bc");
    expect(lines().join("\n")).not.toContain("old output");
    expect(term.buffer.active.baseY).toBe(0);
    await write("new output\x1b[H\x1b[2J\x1b[3J");
    expect(lines()).toContain("new output");
  });

  it("leaves explicit clear() destructive", async () => {
    const { term, write, lines } = setup();
    await write("history\r\n".repeat(8) + "prompt> ");
    term.clear();
    expect(lines().join("\n")).not.toContain("history");
    expect(lines()[0]).toBe("prompt> ");
    expect(term.buffer.active.baseY).toBe(0);
  });

  it("still honors bounded or disabled scrollback", async () => {
    const bounded = setup(40, 4, 3);
    await bounded.write("old\r\n".repeat(12) + "recent\x1b[H\x1b[2J\x1b[3J");
    expect(bounded.term.buffer.active.length).toBeLessThanOrEqual(7);
    const disabled = setup(40, 4, 0);
    await disabled.write("old\x1b[H\x1b[2J\x1b[3J");
    expect(disabled.term.buffer.active.baseY).toBe(0);
    expect(disabled.lines().join("\n")).not.toContain("old");
  });

  it("restores the original option and parser behavior on idempotent disposal", async () => {
    const { term, policy, write, lines } = setup();
    expect(term.options.scrollOnEraseInDisplay).toBe(true);
    policy.dispose();
    policy.dispose();
    expect(term.options.scrollOnEraseInDisplay).toBe(false);
    await write("history\r\n".repeat(8) + "visible\x1b[H\x1b[2J\x1b[3J");
    expect(lines().join("\n")).not.toContain("history");
    expect(lines().join("\n")).not.toContain("visible");
    expect(term.buffer.active.baseY).toBe(0);
  });
});
