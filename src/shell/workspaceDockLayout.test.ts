import { describe, expect, it } from "vitest";
import type { Pane } from "../terminalPanes";
import { parseWorkspaceDockHeight, terminalMinimumHeight, workspaceDockGeometry } from "./workspaceDockLayout";

const leaf = (id: number): Pane => ({ kind: "leaf", id });
const split = (dir: "row" | "col", ratio: number, a: Pane = leaf(1), b: Pane = leaf(2)): Pane => ({ kind: "split", id: 3, dir, ratio, a, b });

describe("workspace dock geometry", () => {
  it("starts at 28% of its actual available column, capped at 260px", () => {
    expect(workspaceDockGeometry(800, leaf(1)).height).toBe(224);
    expect(workspaceDockGeometry(1200, leaf(1)).height).toBe(260);
    expect(workspaceDockGeometry(400, leaf(1)).height).toBe(160);
  });

  it("protects the terminal when persisted or dragged heights are too large", () => {
    const geometry = workspaceDockGeometry(600, leaf(1), 10000);
    expect(geometry.height).toBe(458);
    expect(600 - geometry.height).toBe(geometry.terminalMinHeight);
    expect(workspaceDockGeometry(600, leaf(1), 50).height).toBe(160);
  });

  it("uses the tallest row child and preserves unequal vertical split ratios", () => {
    expect(terminalMinimumHeight(split("row", 0.2))).toBe(140);
    expect(terminalMinimumHeight(split("col", 0.5))).toBe(282);
    expect(terminalMinimumHeight(split("col", 0.2))).toBe(702);
    const nested = split("col", 0.3, split("col", 0.5), split("row", 0.8));
    expect(terminalMinimumHeight(nested)).toBe(942);
    expect(terminalMinimumHeight(split("row", 0.5, nested))).toBe(942);
    expect(workspaceDockGeometry(800, split("col", 0.2))).toMatchObject({ cramped: true, height: 32 });
    expect(workspaceDockGeometry(1000, split("col", 0.2), 500).height).toBe(296);
  });

  it("switches to a compact header instead of violating the expanded minimum", () => {
    expect(workspaceDockGeometry(301, leaf(1))).toMatchObject({ cramped: true, height: 32, maxHeight: 159 });
    expect(workspaceDockGeometry(302, leaf(1))).toMatchObject({ cramped: false, height: 160 });
    expect(workspaceDockGeometry(100, leaf(1))).toMatchObject({ cramped: true, height: 32, maxHeight: 0 });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -20, 0])("handles unusable measurements (%s)", (height) => {
    expect(workspaceDockGeometry(height, leaf(1))).toMatchObject({ cramped: true, height: 32, maxHeight: 0 });
  });

  it("rounds conservatively so fractional containers still retain terminal space", () => {
    const geometry = workspaceDockGeometry(601.8, split("col", 0.4), 1000);
    expect(601.8 - geometry.height).toBeGreaterThanOrEqual(geometry.terminalMinHeight);
  });

  it.each([null, "", " ", "NaN", "Infinity", "-10", "0", "159", "240px", "{}"])('ignores corrupt or too-small saved sizes (%s)', (value) => {
    expect(parseWorkspaceDockHeight(value)).toBeNull();
  });

  it("accepts saved pixels and clamps valid huge sizes only against the measured container", () => {
    expect(parseWorkspaceDockHeight("230.8")).toBe(231);
    expect(parseWorkspaceDockHeight("900000")).toBe(900000);
    expect(workspaceDockGeometry(800, leaf(1), parseWorkspaceDockHeight("900000")).height).toBe(658);
  });
});
