import { describe, expect, it } from "vitest";
import { canAutoApplySubscriptionEdits } from "./subscriptionAutoApplySafety";

describe("subscription auto-apply safety", () => {
  it("allows a small source edit", () => {
    expect(canAutoApplySubscriptionEdits([
      { kind: "edit", path: "/work/husk/src/App.tsx", search: "old", replace: "new" },
    ])).toEqual({ ok: true });
  });

  it("leaves secrets and generated/dependency folders for manual review", () => {
    expect(canAutoApplySubscriptionEdits([
      { kind: "create", path: "/work/husk/.env.local", content: "TOKEN=value" },
    ])).toMatchObject({ ok: false });
    expect(canAutoApplySubscriptionEdits([
      { kind: "edit", path: "/work/husk/node_modules/pkg/index.js", search: "a", replace: "b" },
    ])).toMatchObject({ ok: false });
  });
});
