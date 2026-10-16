// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { getStatusBarPreferences, parseStatusBarPreferences, updateStatusBarPreferences } from "./statusBarPreferences";

beforeEach(() => { localStorage.clear(); updateStatusBarPreferences({ pinned: [], machineMetrics: false }); });
it("defaults to no pinned tools or always-on machine polling", () => {
  for (const raw of [null, "bad json", "null", "{}", "[]"]) expect(parseStatusBarPreferences(raw)).toEqual({ pinned: [], machineMetrics: false });
});
it("accepts known tools and a real boolean, with no duplicates", () => {
  expect(parseStatusBarPreferences(JSON.stringify({ pinned: ["aws", "unknown", "aws", "docker"], machineMetrics: "true" })))
    .toEqual({ pinned: ["docker", "aws"], machineMetrics: false });
});
it("round-trips safe directly used CLI IDs, but not paths or command arguments", () => {
  const pinned = ["cli:az", "cli:teamctl", "cli:az", "cli:/opt/bin/tool", "cli:az account show", "cli:$TOOL", "cli:", "cli:bad\n", "docker"];
  updateStatusBarPreferences({ pinned, machineMetrics: false } as Parameters<typeof updateStatusBarPreferences>[0]);
  const parsed = { pinned: ["docker", "cli:az", "cli:teamctl"], machineMetrics: false };
  expect(getStatusBarPreferences()).toEqual(parsed);
  expect(parseStatusBarPreferences(localStorage.getItem("husk.terminal.statusbar.v1"))).toEqual(parsed);
});
it("persists display choices only, never arbitrary host, command, or target data", () => {
  updateStatusBarPreferences({ pinned: ["terraform"], machineMetrics: true, host: "secret-host", command: "secret command" } as Parameters<typeof updateStatusBarPreferences>[0]);
  expect(getStatusBarPreferences()).toEqual({ pinned: ["terraform"], machineMetrics: true });
  expect(JSON.parse(localStorage.getItem("husk.terminal.statusbar.v1")!)).toEqual({ pinned: ["terraform"], machineMetrics: true });
});
