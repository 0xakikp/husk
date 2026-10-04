import { describe, expect, it, vi } from "vitest";

/* Pane helpers are pure. Mock the rendered terminal so this test does not need
   xterm or the app-only Vite alias chain. */
vi.mock("./Terminal", () => ({ TerminalView: () => null }));

import { hydratePane, newLeaf, setLeafCheckpoint, setLeafCwd, type Pane } from "./terminalPanes";
import { leafIds } from "./terminal/paneUtils";

const savedLayout = {
  kind: "split",
  id: 1100,
  dir: "row",
  ratio: 0.62,
  a: {
    kind: "leaf",
    id: 1101,
    initialCwd: "/work/husk",
    checkpoint: { cwd: "/work/husk", command: "pnpm test", exitCode: 0, at: 1 },
  },
  b: { kind: "leaf", id: 1102, initialCwd: "/work/docs" },
};

describe("terminal workspace restore", () => {
  it("does not retain invalid runtime launch values in new or restored panes", () => {
    const cyclic = { self: null as unknown }; cyclic.self = cyclic;
    const fresh = newLeaf(cyclic as unknown as string);
    const restored = hydratePane({ kind: "leaf", id: 1700, initialCwd: cyclic });
    expect(fresh).toMatchObject({ kind: "leaf", initialCwd: undefined });
    expect(restored).toMatchObject({ kind: "leaf", initialCwd: undefined });
    expect(() => JSON.stringify({ fresh, restored })).not.toThrow();
  });

  it("rehydrates the complete pane tree with checkpoints", () => {
    const pane = hydratePane(savedLayout);
    expect(pane).not.toBeNull();
    expect(leafIds(pane!)).toEqual([1101, 1102]);
    const first = (pane as Extract<Pane, { kind: "split" }>).a as Extract<Pane, { kind: "leaf" }>;
    expect(first.restored).toBe(true);
    expect(first.checkpoint).toMatchObject({ command: "pnpm test", exitCode: 0 });
  });

  it("tracks a later cwd and checkpoint without changing the layout", () => {
    const pane = hydratePane(savedLayout)!;
    const moved = setLeafCwd(pane, 1102, "/work/docs/site");
    const updated = setLeafCheckpoint(moved, 1102, { command: "pnpm lint", exitCode: 0, at: 2 });
    const second = (updated as Extract<Pane, { kind: "split" }>).b as Extract<Pane, { kind: "leaf" }>;
    expect(second.initialCwd).toBe("/work/docs/site");
    expect(second.checkpoint).toMatchObject({ command: "pnpm lint", exitCode: 0 });
  });

  it("rejects corrupt or duplicate pane IDs", () => {
    expect(hydratePane({ kind: "leaf", id: 0 })).toBeNull();
    expect(hydratePane({ ...savedLayout, b: { kind: "leaf", id: 1101 } })).toBeNull();
  });
});
