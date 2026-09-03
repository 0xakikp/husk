import { describe, expect, it } from "vitest";
import {
  isVaultPathWithin,
  normalizedVaultName,
  replaceVaultPath,
  vaultJoin,
  vaultNameError,
  vaultParent,
} from "./vaultPaths";

describe("Vault paths", () => {
  it("uses path boundaries when matching and replacing folders", () => {
    expect(isVaultPathWithin("/vault/ops/note.md", "/vault/ops")).toBe(true);
    expect(isVaultPathWithin("/vault/ops-old/note.md", "/vault/ops")).toBe(false);
    expect(replaceVaultPath("/vault/ops/note.md", "/vault/ops", "/vault/runbooks")).toBe("/vault/runbooks/note.md");
    expect(replaceVaultPath("/vault/ops-old/note.md", "/vault/ops", "/vault/runbooks")).toBe("/vault/ops-old/note.md");
  });

  it("builds destinations and preserves a note extension on a simple rename", () => {
    expect(vaultParent("/vault/ideas/test.md")).toBe("/vault/ideas");
    expect(vaultJoin("/vault/ideas/", "next.md")).toBe("/vault/ideas/next.md");
    expect(normalizedVaultName("test.md", "next", false)).toBe("next.md");
    expect(normalizedVaultName("test.md", "next.txt", false)).toBe("next.txt");
    expect(normalizedVaultName("Ideas", "Archive", true)).toBe("Archive");
  });

  it("rejects empty names and path separators", () => {
    expect(vaultNameError("  ")).toBeTruthy();
    expect(vaultNameError("../outside")).toBeTruthy();
    expect(vaultNameError("safe note")).toBeNull();
  });
});
