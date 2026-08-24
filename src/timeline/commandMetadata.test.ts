import { describe, expect, it } from "vitest";

import { safeTimelineCommand } from "./commandMetadata";

describe("safeTimelineCommand", () => {
  it("keeps ordinary commands in structured metadata", () => {
    expect(safeTimelineCommand("  pnpm   test  ")).toEqual({
      display: "pnpm test",
      command: "pnpm test",
      sensitive: false,
    });
  });

  it("drops the entire command when credentials may be present", () => {
    expect(safeTimelineCommand("curl --token abc123 example.com")).toEqual({
      display: "[sensitive command]",
      sensitive: true,
    });
    expect(safeTimelineCommand("curl https://me:supersecret@example.com").command).toBeUndefined();
    expect(safeTimelineCommand("export API_KEY=short").command).toBeUndefined();
    expect(safeTimelineCommand("PGPASSWORD=tiny psql app").command).toBeUndefined();
  });
});
