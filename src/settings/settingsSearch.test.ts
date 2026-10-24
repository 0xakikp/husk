import { describe, expect, it } from "vitest";
import { searchSettings, SETTINGS_AREAS } from "./settingsSearch";

describe("settings search", () => {
  it.each(["", "  ", "---", "\n\t"])('ignores an empty query "%s"', query => {
    expect(searchSettings(query)).toEqual([]);
  });

  it.each([
    ["scrollback", "config", "scrollback"],
    ["minimap", "config", "minimap"],
    ["terminal font size", "config", "terminal.fontSize"],
    ["terminal fontsize", "config", "terminal.fontSize"],
    ["terminal.fontSize", "config", "terminal.fontSize"],
    ["EDITOR fontSize", "config", "editor.fontSize"],
    ["line rectangle", "config", "lineHighlight"],
    ["wallpaper opacity", "appearance", "appearance.Opacity"],
    ["AI opacity", "appearance", "appearance.AI opacity"],
    ["personalMemory", "agents", "personalMemory"],
    ["AI context budget", "agents", "contextBudget"],
    ["default model", "models", "defaultModel"],
  ])('finds "%s" at its specific control', (query, area, target) => {
    expect(searchSettings(query)).toEqual(expect.arrayContaining([expect.objectContaining({ area, target })]));
  });

  it.each([["privacy telemetry", "crash"], ["models API key", "models"], ["backup passphrase", "sync"], ["MCP arguments", "mcp"]])('finds the right area for "%s"', (query, area) => {
    expect(searchSettings(query)).toEqual(expect.arrayContaining([expect.objectContaining({ area })]));
  });

  it("requires all query words and keeps editor/terminal controls separate", () => {
    expect(searchSettings("terminal font size").map(result => result.target)).toEqual(["terminal.fontSize"]);
    expect(searchSettings("editor cursor blink").map(result => result.target)).toEqual(["editor.cursorBlink"]);
    expect(searchSettings("scrollback password")).toEqual([]);
  });

  it("prioritizes exact labels and uses unique result identities", () => {
    expect(searchSettings("Privacy")[0].area).toBe("crash");
    expect(searchSettings("Terminal font size")[0].target).toBe("terminal.fontSize");
    for (const area of SETTINGS_AREAS) {
      const keys = searchSettings(area.label).map(result => `${result.area}:${result.target ?? "area"}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("does not index arbitrary credential, path, or prompt contents", () => {
    expect(searchSettings("fixture-private-password-839181")).toEqual([]);
    expect(searchSettings("/fixture/private/workspace" )).toEqual([]);
  });
});
