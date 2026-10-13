import { afterEach, beforeEach, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({ define: vi.fn() }));
vi.mock("monaco-editor", () => ({ editor: { defineTheme: theme.define } }));
vi.mock("monaco-editor/esm/vs/editor/editor.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/language/json/json.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/language/css/css.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/language/html/html.worker?worker", () => ({ default: class {} }));
vi.mock("monaco-editor/esm/vs/language/typescript/ts.worker?worker", () => ({ default: class {} }));

beforeEach(() => {
  vi.resetModules();
  theme.define.mockClear();
  vi.stubGlobal("self", {});
});
afterEach(() => { vi.unstubAllGlobals(); });

it("removes the current-line rectangle in both themes without changing cursor or selection styles", async () => {
  await import("./monacoEnv");
  for (const [name, base] of [["husk-black", "vs-dark"], ["husk-light", "vs"]]) {
    const entry = theme.define.mock.calls.find(([key]) => key === name)?.[1];
    expect(entry).toMatchObject({ base, inherit: true, colors: { "editor.lineHighlightBorder": "#00000000" } });
    expect(entry.colors).not.toHaveProperty("editorCursor.foreground");
    expect(entry.colors).not.toHaveProperty("editorLineNumber.activeForeground");
  }
  const dark = theme.define.mock.calls.find(([key]) => key === "husk-black")![1];
  expect(dark.colors["editor.selectionBackground"]).toBe("#264f7880");
});

it("does not restore the rectangle when wallpaper opacity changes", async () => {
  const { defineHuskTheme } = await import("./monacoEnv");
  defineHuskTheme(50);
  expect(theme.define).toHaveBeenLastCalledWith("husk-black", expect.objectContaining({
    colors: expect.objectContaining({ "editor.background": "#00000080", "editor.lineHighlightBorder": "#00000000" }),
  }));
});
