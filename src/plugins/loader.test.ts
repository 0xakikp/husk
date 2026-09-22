import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../fs", () => ({ readDir: vi.fn(), readFileScoped: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { readDir, readFileScoped } from "../fs";
import { invoke } from "@tauri-apps/api/core";
import { loadPlugins, MAX_PLUGIN_FILE_BYTES, parseOutput, runView } from "./loader";
import { parsePlugin, buildPluginActionCommand } from "./types";
import { pluginCommandArgv } from "./command";
import { tokenizeCommand } from "../lib/shellQuote";

const view = { title: "Things", command: "tool list", format: "json" as const };
beforeEach(() => { vi.resetAllMocks(); });

it("distinguishes a failed folder read from an empty folder", async () => {
  vi.mocked(readDir).mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce([]);
  await expect(loadPlugins("/plugins")).rejects.toThrow("permission denied");
  await expect(loadPlugins("/plugins")).resolves.toEqual([]);
});
it("loads scoped, bounded files and keeps malformed definitions visible", async () => {
  vi.mocked(readDir).mockResolvedValue([
    { name: "bad.json", path: "/plugins/bad.json", is_dir: false },
    { name: "good.json", path: "/plugins/good.json", is_dir: false },
    { name: "directory.json", path: "/plugins/directory.json", is_dir: true },
  ]);
  vi.mocked(readFileScoped).mockImplementation(async (path) => path.includes("bad") ? "{" : JSON.stringify({ name: "Good", views: [view] }));
  const results = await loadPlugins("/plugins");
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({ id: "bad", error: expect.stringContaining("valid JSON") });
  expect(results[1]).toMatchObject({ plugin: { name: "Good" } });
  expect(readFileScoped).toHaveBeenCalledWith("/plugins/good.json", "/plugins", MAX_PLUGIN_FILE_BYTES);
});
it("rejects too many or oversized files rather than accepting a partial catalog", async () => {
  vi.mocked(readDir).mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ name: i + ".json", path: "/plugins/" + i, is_dir: false })));
  await expect(loadPlugins("/plugins")).rejects.toThrow("more than 100");
  expect(readFileScoped).not.toHaveBeenCalled();
  vi.mocked(readDir).mockResolvedValue([{ name: "big.json", path: "/plugins/big.json", is_dir: false }]);
  vi.mocked(readFileScoped).mockResolvedValue("x".repeat(MAX_PLUGIN_FILE_BYTES + 1));
  expect(await loadPlugins("/plugins")).toMatchObject([{ error: expect.stringContaining("128 KiB") }]);
});
it.each([Infinity, NaN, 0, -2, 86401])("rejects invalid refresh interval %s", (refresh) => {
  expect(parsePlugin("test", { views: [{ ...view, refresh }] })).toHaveProperty("error");
});
it("validates brand, view count, columns, and UTF-8 command sizes", () => {
  expect(parsePlugin("test", { brand: "url(x)", views: [view] })).toHaveProperty("error");
  expect(parsePlugin("test", { views: Array(21).fill(view) })).toHaveProperty("error");
  expect(parsePlugin("test", { views: [{ ...view, columns: ["id", "id"] }] })).toHaveProperty("error");
  expect(parsePlugin("test", { views: [{ ...view, command: "tool '" + "é".repeat(4000) + "'" }] })).toHaveProperty("error");
  expect(parsePlugin("test", { brand: "#abcdef", views: [{ ...view, refresh: 5 }] })).toHaveProperty("plugin");
});
it("substitutes row values as literal argv, including quotes and shell metacharacters", () => {
  const value = "odd'name; $(touch /tmp/nope) & *";
  const command = buildPluginActionCommand({ command: 'tool inspect "{Full name}" --label=prefix-{ID}' }, { "Full name": value, ID: "a b" });
  expect(tokenizeCommand(command)).toEqual(["tool", "inspect", value, "--label=prefix-a b"]);
  expect(command).toContain("'\\''");
});
it.each(["tool x | next", "tool $(whoami)", "tool \"$HOME\"", "tool 'unterminated", "tool ''", "tool *.json", "tool x\nnext"])("rejects unsupported authored command syntax: %s", (command) => {
  expect(() => pluginCommandArgv(command)).toThrow();
});
it("rejects missing, inherited, malformed, or control-bearing placeholders", () => {
  for (const command of ["tool {missing}", "tool {constructor}", "tool {broken", "{ID} inspect"]) {
    expect(() => buildPluginActionCommand({ command }, { ID: "one" })).toThrow();
  }
  expect(() => buildPluginActionCommand({ command: "tool {ID}" }, { ID: "one\nnext" })).toThrow();
  expect(() => buildPluginActionCommand({ command: "sh -c '{ID}'" }, { ID: "anything" })).toThrow();
});
it("keeps prototype-like JSON field names as own literal data", () => {
  const output = parseOutput(view, '{"__proto__":"literal","constructor":"also literal","id":2}');
  expect(output.error).toBeUndefined();
  expect(Object.getPrototypeOf(output.rows[0])).toBeNull();
  expect(output.rows[0].__proto__).toBe("literal");
  expect(tokenizeCommand(buildPluginActionCommand({ command: "tool {__proto__}" }, output.rows[0]))).toEqual(["tool", "literal"]);
});
it("handles null/scalars, rejects ambiguous columns, and marks partial output", () => {
  expect(parseOutput(view, '[null, 3, "text"]').rows.map((row) => row.Value)).toEqual(["null", "3", "text"]);
  expect(parseOutput({ ...view, format: "table" }, "ID  ID\na  b").error).toContain("duplicate");
  expect(parseOutput(view, JSON.stringify(Array(201).fill({ id: "one" })))).toMatchObject({ truncated: true, status: "truncated" });
  expect(parseOutput(view, JSON.stringify({ id: "x".repeat(8001) })).error).toContain("8,000");
});
it("never accepts native failed, timed-out or truncated output as actionable rows", async () => {
  for (const flags of [{ exit_code: 1 }, { timed_out: true }, { truncated: true }]) {
    vi.mocked(invoke).mockResolvedValue({ exit_code: 0, stdout: '[{"id":"unsafe"}]', stderr: "oops", ...flags });
    const output = await runView(view, "/project");
    expect(output.error).toBeTruthy(); expect(output.rows).toEqual([]);
  }
});
it("holds an aborted request pending until native settlement and ignores its rows", async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(invoke).mockReturnValue(new Promise((done) => { resolve = done; }));
  const controller = new AbortController();
  const result = runView(view, "/project", { signal: controller.signal });
  let settled = false; void result.then(() => { settled = true; });
  controller.abort(); await Promise.resolve(); expect(settled).toBe(false);
  resolve({ exit_code: 0, stdout: '[{"id":"late"}]', stderr: "" });
  await expect(result).resolves.toMatchObject({ status: "cancelled", rows: [] });
  vi.mocked(invoke).mockClear();
  await runView(view, "/project", { signal: controller.signal });
  expect(invoke).not.toHaveBeenCalled();
});
