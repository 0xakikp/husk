import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { watchFileChanges } from "./editor/fileChanges";
import * as fs from "./fs";
import { sshWriteFile } from "./remote/remoteFs";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

describe("local filesystem mutation notifications", () => {
  const changed = vi.fn();
  let unwatch: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(undefined);
    unwatch = watchFileChanges(changed);
  });
  afterEach(() => unwatch());

  it("waits for settlement before notifying and preserves native arguments", async () => {
    let finish!: () => void;
    vi.mocked(invoke).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const pending = fs.writeFile("/workspace/note.txt", "new contents");
    expect(changed).not.toHaveBeenCalled();
    finish();
    await pending;
    expect(invoke).toHaveBeenCalledWith("write_file", { path: "/workspace/note.txt", contents: "new contents" });
    expect(changed).toHaveBeenCalledExactlyOnceWith("/workspace/note.txt");
  });

  it("invalidates after partial failure without replacing the original error", async () => {
    const failure = { message: "Copy failed after a partial write" };
    vi.mocked(invoke).mockRejectedValue(failure);
    await expect(fs.copyPath("/workspace/from", "/workspace/to")).rejects.toBe(failure);
    expect(changed).toHaveBeenCalledExactlyOnceWith("/workspace/to");
  });

  it("invalidates both sides of rename, deduplicating equal paths", async () => {
    await fs.renamePath("/workspace/from", "/workspace/to");
    expect(changed.mock.calls).toEqual([["/workspace/from"], ["/workspace/to"]]);
    changed.mockClear();
    await fs.renamePath("/workspace/same", "/workspace/same");
    expect(changed).toHaveBeenCalledExactlyOnceWith("/workspace/same");
  });

  it("announces each scoped, create, delete, binary, and trash mutation", async () => {
    const path = "/workspace/file";
    const mutations = [
      () => fs.writeFileScoped(path, "text", "/workspace"),
      () => fs.writeNewFileScoped(path, "text", "/workspace"),
      () => fs.deleteFileScoped(path, "/workspace"),
      () => fs.createDirScoped(path, "/workspace"),
      () => fs.writeBinaryFile(path, [1, 2]),
      () => fs.createFile(path),
      () => fs.createDir(path),
      () => fs.deletePath(path),
      () => fs.trashPath(path),
    ];
    for (const mutation of mutations) await mutation();
    expect(changed.mock.calls).toEqual(mutations.map(() => [path]));
    expect(invoke).toHaveBeenLastCalledWith("trash_path", { path });
  });

  it("does not announce reads or mix SSH mutations into local paths", async () => {
    await fs.readDir("/workspace");
    await fs.readFile("/workspace/file");
    await fs.readDirScoped("/workspace", "/workspace");
    await fs.readFileScoped("/workspace/file", "/workspace");
    await sshWriteFile("example-host", "/workspace/file", "remote contents");
    expect(changed).not.toHaveBeenCalled();
  });

  it("a broken subscriber cannot mask successful mutations or native failures", async () => {
    const unsubscribe = watchFileChanges(() => { throw new Error("listener failure"); });
    try {
      await expect(fs.createFile("/workspace/new")).resolves.toBeUndefined();
      vi.mocked(invoke).mockRejectedValue("native failure");
      await expect(fs.deletePath("/workspace/file")).rejects.toBe("native failure");
    } finally {
      unsubscribe();
    }
  });
});
