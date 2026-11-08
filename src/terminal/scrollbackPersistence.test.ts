// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { IDBFactory } from "fake-indexeddb";
import { createScrollbackArchive, newScrollbackKey, type ScrollbackArchive } from "./scrollbackArchive";
import { TerminalScrollbackPersistence, snapshotTerminalRows } from "./scrollbackPersistence";
import { installScrollbackClearPolicy } from "./scrollbackClear";

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).reverse().forEach(dispose => dispose()); vi.useRealTimers(); });
function archive() { const a = createScrollbackArchive({ factory: new IDBFactory(), name: newScrollbackKey() }); disposers.push(() => a.close()); return a; }
async function setup(a = archive(), key = newScrollbackKey(), enabled = true, restored = false) {
  const term = new Terminal({ cols: 60, rows: 4, scrollback: 1000, allowProposedApi: true });
  const policy = installScrollbackClearPolicy(term);
  const report = vi.fn();
  const history = new TerminalScrollbackPersistence(term, key, { enabled, retentionDays: 7 }, a, report);
  disposers.push(() => { history.dispose(false); policy.dispose(); term.dispose(); });
  await history.initialize(restored);
  const write = (data: string) => new Promise<void>(resolve => term.write(data, resolve));
  return { term, history, write, a, key, report };
}

it("restores previous output as display before a fresh shell without replaying input", async () => {
  const first = await setup();
  await first.write("work from yesterday\r\nresult: success\r\n");
  expect(await first.history.flush()).toBe(true);
  const second = await setup(first.a, first.key, true, true);
  const input = vi.fn(); second.term.onData(input);
  await second.write("\x1b[H\x1b[2J\x1b[3Jnew-shell> ");
  const text = snapshotTerminalRows(second.term).join("\n");
  expect(text).toContain("work from yesterday"); expect(text).toContain("result: success");
  expect(text).toContain("New shell · commands are not replayed"); expect(text).toContain("new-shell>");
  expect(second.history.restored).toBe(true); expect(input).not.toHaveBeenCalled();
});

it("does not access storage or record anything unless opted in", async () => {
  const a = archive(); const read = vi.spyOn(a, "read"); const save = vi.spyOn(a, "save"); const remove = vi.spyOn(a, "delete");
  const { history, write } = await setup(a, newScrollbackKey(), false, true);
  await write("private output"); await history.flush(); history.dispose();
  expect(read).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
});

it("restores at the captured width before layout fitting, preserving wide output", async () => {
  const first = await setup(); first.term.resize(200, 4);
  await first.write(Array.from({ length: 500 }, (_, i) => `${i} ${"x".repeat(180)}\r\n`).join(""));
  await first.history.flush();
  const second = await setup(first.a, first.key, true, true);
  expect(second.term.cols).toBe(200);
  expect(snapshotTerminalRows(second.term).join("\n")).toContain("0 " + "x".repeat(180));
  expect(snapshotTerminalRows(second.term).join("\n")).toContain("499 " + "x".repeat(180));
});

it("keeps the old snapshot if a restart read fails, but does not block terminal output", async () => {
  const a = archive(); const key = newScrollbackKey(); await a.read(key); await a.save(key, ["saved original"]);
  const original = a.read.bind(a); vi.spyOn(a, "read").mockRejectedValue(new Error("unavailable"));
  const { history, write, report } = await setup(a, key, true, true);
  await write("live shell still works"); await history.flush();
  expect((await original(key))?.rows).toEqual(["saved original"]); expect(report).toHaveBeenCalledOnce();
});

it("ignores alternate-screen content while preserving the normal shell output", async () => {
  const { term, history, write, a, key } = await setup();
  await write("normal work\r\n"); await history.flush();
  await write("\x1b[?1049hprivate fullscreen frame\x1b[H\x1b[2Jsecond frame");
  await history.flush();
  expect((await a.read(key))?.rows.join("\n")).toContain("normal work");
  expect((await a.read(key))?.rows.join("\n")).not.toContain("frame");
  await write("\x1b[?1049lmore normal\r\n"); await history.flush();
  expect(snapshotTerminalRows(term).join("\n")).not.toContain("frame");
});

it("does not immediately re-save old visible rows after deleting the archive", async () => {
  const { history, write, a, key } = await setup();
  await write("old secret output\r\nprompt> "); await history.flush();
  await a.clearAll(); await history.flush(); expect(await a.read(key)).toBeNull();
  await write("new command\r\nnew output\r\n"); await history.flush();
  const saved = (await a.read(key))?.rows.join("\n");
  expect(saved).toContain("new output"); expect(saved).not.toContain("old secret");
});

it("does not restore a delayed snapshot after recording is disabled", async () => {
  const a = archive(); const key = newScrollbackKey();
  let deliver!: (value: Awaited<ReturnType<ScrollbackArchive["read"]>>) => void;
  vi.spyOn(a, "read").mockReturnValue(new Promise(resolve => { deliver = resolve; }));
  const term = new Terminal({ allowProposedApi: true });
  const history = new TerminalScrollbackPersistence(term, key, { enabled: true, retentionDays: 7 }, a, vi.fn());
  disposers.push(() => { history.dispose(false); term.dispose(); });
  const pending = history.initialize(true); history.configure({ enabled: false, retentionDays: 7 });
  deliver({ key, rows: ["must not display"], bytes: 17, savedAt: Date.now(), truncated: false }); await pending;
  expect(snapshotTerminalRows(term).join("\n")).not.toContain("must not display");
});

it("cancels a pending xterm restoration when the pane closes", async () => {
  const a = archive(); const key = newScrollbackKey(); await a.read(key); await a.save(key, ["old"]);
  const term = new Terminal({ allowProposedApi: true });
  const write = vi.spyOn(term, "write").mockImplementation(() => {});
  const history = new TerminalScrollbackPersistence(term, key, { enabled: true, retentionDays: 7 }, a, vi.fn());
  disposers.push(() => { history.dispose(false); term.dispose(); });
  const pending = history.initialize(true);
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  history.dispose(false); await pending; expect(history.restored).toBe(false);
});

it("removes staged output if recording is disabled while xterm is parsing restoration", async () => {
  const a = archive(); const key = newScrollbackKey(); await a.read(key); await a.save(key, ["old"]);
  const term = new Terminal({ allowProposedApi: true });
  const original = term.write.bind(term); let finish!: () => void;
  vi.spyOn(term, "write").mockImplementationOnce((data, callback) => { original(data, () => { finish = callback!; }); });
  const history = new TerminalScrollbackPersistence(term, key, { enabled: true, retentionDays: 7 }, a, vi.fn());
  disposers.push(() => { history.dispose(false); term.dispose(); });
  const pending = history.initialize(true);
  await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
  history.configure({ enabled: false, retentionDays: 7 }); finish(); await pending;
  expect(history.restored).toBe(false); expect(snapshotTerminalRows(term)).toEqual([]);
});

it("withholds terminal controls even when the archive returns malformed text", async () => {
  const a = archive(); const key = newScrollbackKey();
  vi.spyOn(a, "read").mockResolvedValue({ key, rows: ["safe\x1b]777;husk;open;/secret\x07end", "\x1b]52;c;abc\x07clipboard"], bytes: 100, savedAt: Date.now(), truncated: false });
  const term = new Terminal({ allowProposedApi: true }); const osc = vi.fn();
  term.parser.registerOscHandler(777, osc); term.parser.registerOscHandler(52, osc); term.onData(osc);
  const history = new TerminalScrollbackPersistence(term, key, { enabled: true, retentionDays: 7 }, a, vi.fn());
  disposers.push(() => { history.dispose(false); term.dispose(); });
  await history.initialize(true);
  expect(osc).not.toHaveBeenCalled(); expect(snapshotTerminalRows(term).join("\n")).toContain("safeend");
});

it("reports failed saves and retries fresh output without throwing into terminal rendering", async () => {
  const { history, write, a, key, report } = await setup(); const save = vi.spyOn(a, "save");
  save.mockRejectedValueOnce(new Error("quota"));
  await write("work\r\n"); expect(await history.flush()).toBe(false); expect(report).toHaveBeenCalledOnce();
  await write("later output\r\n"); expect(await history.flush()).toBe(true);
  expect((await a.read(key))?.rows.join("\n")).toContain("later output");
});

it("closing a pane deletes its saved history", async () => {
  const { history, write, a, key } = await setup();
  await write("work\r\n"); await history.flush(); history.dispose();
  expect(await a.read(key)).toBeNull();
});

it("does not restore history for a fresh pane identity", async () => {
  const a = archive(); const old = await setup(a); await old.write("older pane\r\n"); await old.history.flush();
  const fresh = await setup(a, newScrollbackKey(), true, true);
  expect(fresh.history.restored).toBe(false); expect(snapshotTerminalRows(fresh.term).join("\n")).not.toContain("older pane");
});
