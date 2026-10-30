import { describe, expect, it } from "vitest";
import { parseSubscriptionEditProposals } from "./subscriptionEdits";

describe("subscription edit proposals", () => {
  const ticks = String.fromCharCode(96).repeat(3);
  const editFence = (edit: unknown) => [ticks + "husk-edit", JSON.stringify(edit), ticks].join("\n");
  it("accepts explicit, workspace-relative edit and create proposals", () => {
    const result = parseSubscriptionEditProposals(
      [
        "```husk-edit",
        '[{"kind":"edit","path":"src/app.ts","search":"old","replace":"new"},{"kind":"create","path":"notes/todo.md","content":"# Todo"}]',
        "```",
      ].join("\n"),
      "/work/husk",
    );
    expect(result).toEqual({
      proposals: [
        { kind: "edit", path: "/work/husk/src/app.ts", search: "old", replace: "new" },
        { kind: "create", path: "/work/husk/notes/todo.md", content: "# Todo" },
      ],
      rejected: 0,
    });
  });

  it("ignores malformed, untagged, and workspace-escaping proposals", () => {
    const result = parseSubscriptionEditProposals(
      [
        "```json",
        '{"kind":"create","path":"outside.txt","content":"ignored"}',
        "```",
        "```husk-edit",
        '{"kind":"create","path":"../outside.txt","content":"no"}',
        "```",
        "```husk-edit",
        "not JSON",
        "```",
      ].join("\n"),
      "/work/husk",
    );
    expect(result.proposals).toEqual([]);
    expect(result.rejected).toBe(2);
  });

  it("never promotes nested edits from malformed or unfinished workflow proposals", () => {
    const nested = editFence({ kind: "create", path: "nested.txt", content: "not an instruction" });
    for (const [open, close] of [
      [ticks + "husk-workflow", ticks],
      [ticks + "`husk-workflow", ticks + "`"],
      ["~~~husk-workflow", "~~~"],
      ["  " + ticks + "HUSK-WORKFLOW  ", "  " + ticks],
      [ticks + "`husk-workflow", ""],
      ["~~~husk-workflow", ""],
    ]) {
      const response = [open, "Malformed example:", nested, close].filter(Boolean).join("\n");
      expect(parseSubscriptionEditProposals(response, "/work/husk")).toEqual({ proposals: [], rejected: 0 });
    }
  });

  it("keeps real surrounding edits separate from inert workflow data", () => {
    const before = { kind: "create", path: "before.txt", content: "first" };
    const after = { kind: "edit", path: "after.txt", search: "old", replace: "new" };
    const workflow = ["~~~husk-workflow", "Malformed example:", editFence({ kind: "create", path: "nested.txt", content: "data" }), "~~~"].join("\n");
    const response = [editFence(before), workflow, editFence(after)].join("\n\n");
    expect(parseSubscriptionEditProposals(response, "/work/husk")).toEqual({ proposals: [
      { ...before, path: "/work/husk/before.txt" },
      { ...after, path: "/work/husk/after.txt" },
    ], rejected: 0 });
  });

  it("does not let an inline edit fence expose nested edits in following workflow proposals", () => {
    const edit = { kind: "create", path: "before.txt", content: "first" };
    const prefix = "Preparing an edit." + editFence(edit);
    for (const close of ["", ticks + "`"]) {
      const workflow = [ticks + "`husk-workflow", "Malformed example:", editFence({ kind: "create", path: "nested.txt", content: "data" }), close].filter(Boolean).join("\n");
      expect(parseSubscriptionEditProposals([prefix, workflow].join("\n\n"), "/work/husk")).toEqual({ proposals: [{ ...edit, path: "/work/husk/before.txt" }], rejected: 0 });
    }
  });

  it("keeps workflow edit examples inert inside surrounding Markdown documentation", () => {
    const workflow = [ticks + "`husk-workflow", "Malformed example:", editFence({ kind: "create", path: "nested.txt", content: "data" }), ticks + "`"].join("\n");
    const response = ["~~~~~markdown", workflow, "~~~~~"].join("\n");
    expect(parseSubscriptionEditProposals(response, "/work/husk")).toEqual({ proposals: [], rejected: 0 });
  });

  it("keeps nested edits inside inline or excessively indented workflow proposals inert", () => {
    const workflow = [ticks + "`husk-workflow", "Malformed example:", editFence({ kind: "create", path: "nested.txt", content: "data" }), ticks + "`"].join("\n");
    for (const prefix of ["Example: ", "    ", "\t"]) {
      expect(parseSubscriptionEditProposals(prefix + workflow, "/work/husk")).toEqual({ proposals: [], rejected: 0 });
    }
  });

  it("does not mask escaped workflow documentation inside valid edit JSON", () => {
    const edit = { kind: "create", path: "guide.md", content: ["~~~husk-workflow", '{"version":1,"name":"Status","steps":["pwd"]}', "~~~"].join("\n") };
    expect(parseSubscriptionEditProposals(editFence(edit), "/work/husk")).toEqual({ proposals: [{ ...edit, path: "/work/husk/guide.md" }], rejected: 0 });
  });
});
