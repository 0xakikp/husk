import { describe, expect, it } from "vitest";
import { parseVaultLensExpansion, parseVaultSections, rankVaultSections } from "./vaultLens";
import { cleanOrganizedMarkdown } from "./notesAi";

describe("Vault Lens", () => {
  it("creates line-addressable Markdown sections", () => {
    const sections = parseVaultSections("/vault/k8s.md", "k8s.md", "intro\n\n## Certificates\nrenew with cert-manager\n\n## Deploy\nkubectl apply");
    expect(sections.map((section) => [section.heading, section.startLine, section.endLine])).toEqual([
      ["Opening", 1, 2],
      ["Certificates", 3, 5],
      ["Deploy", 6, 7],
    ]);
  });

  it("uses related vocabulary without letting it outrank direct matches", () => {
    const sections = [
      ...parseVaultSections("/vault/a.md", "a.md", "# Kubernetes certificate issue\nrenew the cluster certificate"),
      ...parseVaultSections("/vault/b.md", "b.md", "# TLS notes\ncert-manager rotated the x509 credential"),
    ];
    const results = rankVaultSections(sections, "Kubernetes certificate issue", ["tls", "x509", "cert-manager"]);
    expect(results.map((result) => result.name)).toEqual(["a.md", "b.md"]);
    expect(results[0].startLine).toBe(1);
  });

  it("strictly sanitizes model expansion JSON", () => {
    expect(parseVaultLensExpansion('```json\n{"terms":["TLS","x509","",42,"a" ]}\n```')).toEqual(["tls", "x509"]);
    expect(parseVaultLensExpansion("not json")).toEqual([]);
  });
});

describe("Organize note response", () => {
  it("accepts plain or fenced Markdown and normalizes the final newline", () => {
    expect(cleanOrganizedMarkdown("# Title\n\n- item")).toBe("# Title\n\n- item\n");
    expect(cleanOrganizedMarkdown("```markdown\n# Title\n```" )).toBe("# Title\n");
  });

  it("rejects an action proposal instead of treating it as note content", () => {
    expect(() => cleanOrganizedMarkdown('{"kind":"workspace.write"}')).toThrow();
  });
});
