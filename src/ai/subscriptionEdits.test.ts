import { describe, expect, it } from "vitest";
import { parseSubscriptionEditProposals } from "./subscriptionEdits";

describe("subscription edit proposals", () => {
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
});
