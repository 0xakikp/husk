import { describe, expect, it } from "vitest";
import { buildWelcomeNameArt } from "./welcomeNameArt";

describe("buildWelcomeNameArt", () => {
  it("preserves the trimmed configured name while rendering uppercase art", () => {
    const result = buildWelcomeNameArt("  Aki7  ");
    expect(result.label).toBe("Aki7");
    expect(result.glyphs).toHaveLength(4);
    expect(result.glyphs).toEqual(buildWelcomeNameArt("AKI7").glyphs);
  });

  it.each(["", "  \n\t ", "\u0000\u202e\u2066"])("uses HUSK for an empty display name: %j", (name) => {
    const result = buildWelcomeNameArt(name);
    expect(result.label).toBe("HUSK");
    expect(result.glyphs).toHaveLength(4);
  });

  it.each([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"])("renders %s in exactly three columns and five rows", (name) => {
    const result = buildWelcomeNameArt(name);
    expect(result.glyphs).toHaveLength(1);
    const rows = result.glyphs![0].split("\n");
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row).toHaveLength(3);
      expect(row).toMatch(/^[█ ]{3}$/);
    }
    expect(rows.join("")).toContain("█");
  });

  it("keeps internal spaces as full-width, five-line blank glyphs", () => {
    const result = buildWelcomeNameArt("A  B");
    expect(result.label).toBe("A  B");
    expect(result.glyphs).toHaveLength(4);
    expect(result.glyphs![1]).toBe("   \n   \n   \n   \n   ");
    expect(result.glyphs![2]).toBe(result.glyphs![1]);
  });

  it("supports names up to twelve characters without cutting longer names", () => {
    expect(buildWelcomeNameArt("ABCDEFGHIJKL").glyphs).toHaveLength(12);
    expect(buildWelcomeNameArt("ABCDEFGHIJKLM")).toEqual({ label: "ABCDEFGHIJKLM", glyphs: null });
  });

  it.each(["Aki Kumar Raman", "Zoë", "李明", "علي", "Straße", "aki-p", "aki_p", "Aki 🚀"])("uses the real name as plain text when art is unsupported: %s", (name) => {
    expect(buildWelcomeNameArt(`  ${name}  `)).toEqual({ label: name, glyphs: null });
  });

  it("removes controls, bidi overrides and line separators before displaying a name", () => {
    expect(buildWelcomeNameArt("\u202eA\u0000k\u0085i\u2069\u2028\u2029")).toEqual(buildWelcomeNameArt("Aki"));
    expect(buildWelcomeNameArt("\u061c李\u200f明\u2067")).toEqual({ label: "李明", glyphs: null });
  });
});
