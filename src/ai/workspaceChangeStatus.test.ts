import { describe, expect, it } from "vitest";
import { workspaceChangeStatusContext } from "./workspaceChangeStatus";

describe("workspaceChangeStatusContext", () => {
  it("distinguishes pending review from an applied change", () => {
    const context = workspaceChangeStatusContext({
      workspaceRoot: "/work/project",
      pending: [{
        id: "pending-1",
        path: "/work/project/src/new.ts",
        search: "old",
        replace: "new",
        workspaceRoot: "/work/project",
        timestamp: 10,
      }],
      applied: [{
        id: "applied-1",
        path: "/work/project/add_two_numbers.sh",
        operation: "edit",
        workspaceRoot: "/work/project",
        before: "old",
        after: "new",
        timestamp: 20,
      }],
    });

    expect(context).toContain("Waiting for approval: src/new.ts (update).");
    expect(context).toContain("Already applied to disk: add_two_numbers.sh (updated).");
    expect(context).toContain("An applied change is complete.");
    expect(context).not.toContain("/work/project/add_two_numbers.sh");
  });

  it("adds no prompt text when there is no change activity", () => {
    expect(workspaceChangeStatusContext({ workspaceRoot: "/work/project", pending: [], applied: [] })).toBe("");
  });
});
