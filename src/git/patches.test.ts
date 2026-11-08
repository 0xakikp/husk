import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), run: vi.fn(), output: vi.fn(), paths: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("./client", () => ({ runGit: mock.run, runGitOutput: mock.output, literalGitPaths: mock.paths }));
import { canStageDiffHunks, commitDiff, diffLines, readConflictVersions, stageableHunks, stageDiffHunk } from "./patches";
import type { GitFile } from "./client";
const patch = "diff --git a/a.txt b/a.txt\nindex 123abcd..456abcd 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1,3 +1,4 @@ top\n one\n-old\n+new\n+extra\n three\n@@ -20,2 +21,2 @@ bottom\n twenty\n-last\n+changed\n";
const file: GitFile = { path: "a.txt", index: " ", work: "M", staged: false, unstaged: true, conflicted: false };
const oid = "a".repeat(40);
beforeEach(() => { vi.clearAllMocks(); mock.invoke.mockResolvedValue(undefined); mock.run.mockReset(); mock.output.mockReset(); });

it("parses line numbers without treating file headers as added or removed lines", () => {
  const lines = diffLines(patch);
  expect(lines[2]).toMatchObject({ kind: "meta", text: "--- a/a.txt" });
  expect(lines.find((line) => line.text === "-old")).toMatchObject({ kind: "deletion", oldLine: 2 });
  expect(lines.find((line) => line.text === "+extra")).toMatchObject({ kind: "addition", newLine: 3 });
  expect(lines.find((line) => line.text === " three")).toMatchObject({ kind: "context", oldLine: 3, newLine: 4 });
  expect(lines.find((line) => line.text === "+changed")).toMatchObject({ kind: "addition", newLine: 22 });
  expect(lines.filter((line) => line.kind === "hunk").map((line) => line.hunkIndex)).toEqual([0, 1]);
});
it("does not carry line numbers beyond a complete hunk into another file's headers", () => {
  const lines = diffLines(patch + patch);
  expect(lines.filter((line) => line.text === "--- a/a.txt").every((line) => line.kind === "meta" && line.oldLine === undefined)).toBe(true);
});
it("accepts complete bounded ordinary text hunks only", () => {
  expect(stageableHunks(patch)).toHaveLength(2);
  expect(canStageDiffHunks(file, patch)).toBe(true);
  for (const unsafe of [patch + patch, patch.slice(0, -1), patch.replace("100644", "120000"), patch.replace("100644", "160000"), patch.replace("+1,4", "+1,2"), patch.replace("+++ b/a.txt", "+++ b/other.txt"), patch.replace("+new", "+\0new"), patch.replace("+new", "+\uFFFDnew"), patch.replace("+new", "+" + "x".repeat(250_000)), "Binary files a/a and b/a differ\n"]) expect(stageableHunks(unsafe)).toEqual([]);
  for (const modified of [{ conflicted: true }, { originalPath: "other.txt" }, { index: "?", work: "?" }, { index: "A" }, { work: "D" }, { index: "R" }]) expect(canStageDiffHunks({ ...file, ...modified }, patch)).toBe(false);
});
it("hands only the complete reviewed diff and selected index to native validation", async () => {
  await stageDiffHunk(file, patch, 1, "/repo");
  expect(mock.paths).toHaveBeenCalledWith(["a.txt"]);
  expect(mock.invoke).toHaveBeenCalledWith("git_stage_diff_hunk", { cwd: "/repo", path: "a.txt", reviewedDiff: patch, hunkIndex: 1 });
  expect(mock.run).not.toHaveBeenCalled();
});
it("rejects out of range, unsupported or missing-root staging before IPC", async () => {
  for (const index of [-1, 2, .5, NaN]) await expect(stageDiffHunk(file, patch, index, "/repo")).rejects.toThrow();
  await expect(stageDiffHunk(file, patch, 0, "")).rejects.toThrow();
  await expect(stageDiffHunk({ ...file, conflicted: true }, patch, 0, "/repo")).rejects.toThrow();
  expect(mock.invoke).not.toHaveBeenCalled();
});
it("propagates stale native reviews without unsafe retries", async () => {
  mock.invoke.mockRejectedValueOnce(new Error("The file or index changed"));
  await expect(stageDiffHunk(file, patch, 0, "/repo")).rejects.toThrow("changed");
  expect(mock.invoke).toHaveBeenCalledTimes(1);
});
it("preserves native string errors so lock and stale-review guidance reaches the UI", async () => {
  mock.invoke.mockRejectedValueOnce("Git is busy or an index lock exists.");
  await expect(stageDiffHunk(file, patch, 0, "/repo")).rejects.toThrow("index lock exists");
  expect(mock.invoke).toHaveBeenCalledTimes(1);
});
it("loads immutable commit objects without interpreting arbitrary revisions or options", async () => {
  mock.run.mockResolvedValue("commit diff");
  expect(await commitDiff(oid, "/repo")).toBe("commit diff");
  expect(mock.run).toHaveBeenCalledWith(expect.arrayContaining(["--no-ext-diff", "--no-textconv", "--first-parent", oid, "--"]), "/repo", { allowTruncated: true });
  for (const invalid of ["HEAD", "--output=/tmp/file", "abc", "a".repeat(40) + "~1"]) await expect(commitDiff(invalid, "/repo")).rejects.toThrow("valid commit");
});
it("resolves conflict stage objects before reading immutable blobs", async () => {
  mock.run.mockImplementation(async (args: string[]) => args[0] === "ls-files" ? `100644 ${oid} 1\ta.txt\0` + `100644 ${"b".repeat(40)} 3\ta.txt\0` : "9\n");
  mock.output.mockImplementation(async (args: string[]) => ({ stdout: args[2] === oid ? "base\n" : "incoming\n" }));
  expect(await readConflictVersions("a.txt", "/repo")).toEqual({ base: "base\n", ours: null, theirs: "incoming\n" });
  expect(mock.run).toHaveBeenCalledWith(["ls-files", "--unmerged", "-z", "--", "a.txt"], "/repo");
  expect(mock.output).toHaveBeenCalledWith(["cat-file", "blob", oid], "/repo");
});
it("distinguishes a resolved conflict from missing content and rejects unsupported stages", async () => {
  mock.run.mockResolvedValueOnce(""); await expect(readConflictVersions("a.txt", "/repo")).rejects.toThrow("no longer");
  mock.run.mockResolvedValueOnce(`120000 ${oid} 2\ta.txt\0`); await expect(readConflictVersions("a.txt", "/repo")).rejects.toThrow("symlink");
  mock.run.mockResolvedValueOnce(`100644 ${oid} 2\tother.txt\0`); await expect(readConflictVersions("a.txt", "/repo")).rejects.toThrow("unsupported");
  expect(mock.output).not.toHaveBeenCalled();
});
it("does not present binary or oversized conflict blobs as text", async () => {
  mock.run.mockResolvedValueOnce(`100644 ${oid} 2\ta.txt\0`).mockResolvedValueOnce("99999999");
  await expect(readConflictVersions("a.txt", "/repo")).rejects.toThrow("too large"); expect(mock.output).not.toHaveBeenCalled();
  mock.run.mockResolvedValueOnce(`100644 ${oid} 2\ta.txt\0`).mockResolvedValueOnce("12"); mock.output.mockResolvedValueOnce({ stdout: "binary\0file" });
  await expect(readConflictVersions("a.txt", "/repo")).rejects.toThrow("Binary");
});
