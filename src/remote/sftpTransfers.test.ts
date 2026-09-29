import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cancelTransfer = vi.fn(() => Promise.resolve(true));
const uploadFolder = vi.fn(() => Promise.resolve());
const uploadFile = vi.fn(() => Promise.resolve());
const downloadFile = vi.fn(() => Promise.resolve());
const downloadFolder = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("./sftpApi", () => ({
  sftpCancelTransfer: cancelTransfer,
  sftpDownload: downloadFile,
  sftpDownloadDir: downloadFolder,
  sftpUpload: uploadFile,
  sftpUploadDir: uploadFolder,
}));

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  vi.stubGlobal("CustomEvent", class { constructor(_name: string, _init?: unknown) {} });
  vi.resetModules();
  cancelTransfer.mockClear();
  uploadFolder.mockReset();
  uploadFolder.mockResolvedValue(undefined);
  uploadFile.mockReset(); uploadFile.mockResolvedValue(undefined);
  downloadFile.mockReset(); downloadFile.mockResolvedValue(undefined);
  downloadFolder.mockReset(); downloadFolder.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

describe("SFTP transfer queue", () => {
  it("keeps external-store snapshots stable until the queue changes", async () => {
    const queue = await import("./sftpTransfers");

    const empty = queue.getSftpTransfers("example");
    expect(queue.getSftpTransfers("example")).toBe(empty);

    queue.enqueueSftpTransfer({
      host: "example",
      direction: "upload",
      kind: "file",
      localPath: "/Users/me/build.zip",
      remotePath: "/srv/build.zip",
      label: "build.zip",
    });

    const populated = queue.getSftpTransfers("example");
    expect(populated).not.toBe(empty);
    expect(queue.getSftpTransfers("example")).toBe(populated);
  });

  it("restores an interrupted transfer as paused rather than restarting it at launch", async () => {
    storage.setItem("huskv2.sftp.transferQueue", JSON.stringify([{
      id: "sftp-running",
      host: "example",
      direction: "download",
      kind: "file",
      localPath: "/Users/me/Downloads/report.log",
      remotePath: "/var/log/report.log",
      label: "report.log",
      state: "running",
      progress: 42,
      createdAt: 1,
      updatedAt: 1,
    }]));

    const queue = await import("./sftpTransfers");

    expect(queue.getSftpTransfers("example")).toMatchObject([
      { id: "sftp-running", state: "paused", progress: 42 },
    ]);
  });

  it("persists inactive work as paused without starting or cancelling a native transfer", async () => {
    const queue = await import("./sftpTransfers");
    const task = queue.enqueueSftpTransfer({
      host: "example",
      direction: "upload",
      kind: "file",
      localPath: "/Users/me/build.zip",
      remotePath: "/srv/build.zip",
      label: "build.zip",
    });

    expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "paused" }]);
    expect(storage.getItem("huskv2.sftp.transferQueue")).toContain(task.id);

    queue.pauseSftpTransfer(task.id);

    expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "paused" }]);
    expect(cancelTransfer).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it("keeps paused work resumable and removable", async () => {
    const queue = await import("./sftpTransfers");
    const task = queue.enqueueSftpTransfer({
      host: "example",
      direction: "download",
      kind: "folder",
      localPath: "/Users/me/Downloads",
      remotePath: "/srv/reports",
      label: "reports",
    });

    queue.pauseSftpTransfer(task.id);
    queue.resumeSftpTransfer(task.id);

    expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "paused" }]);
    queue.removeSftpTransfer(task.id);
    expect(queue.getSftpTransfers("example")).toEqual([]);
  });

  it("requires renewed replacement approval and removes old whole-folder replacement on retry", async () => {
    uploadFolder.mockRejectedValueOnce(new Error("connection lost"));
    const queue = await import("./sftpTransfers");
    const deactivate = queue.activateSftpTransferQueue("example");
    const task = queue.enqueueSftpTransfer({
      host: "example",
      direction: "upload",
      kind: "folder",
      localPath: "/Users/me/project",
      remotePath: "/srv",
      label: "project",
      folderConflictStrategy: "replace",
      allowOverwrite: true,
    });

    await vi.waitFor(() => {
      expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "failed" }]);
    });
    expect(uploadFolder).toHaveBeenLastCalledWith("example", "/Users/me/project", "/srv", task.id, false, "replace", true);

    queue.retrySftpTransfer(task.id);
    await vi.waitFor(() => {
      expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "completed" }]);
    });
    expect(uploadFolder).toHaveBeenLastCalledWith("example", "/Users/me/project", "/srv", task.id, true, "merge", false);
    deactivate();
  });

  it("accepts renewed file replacement approval after a paused transfer is reviewed", async () => {
    const queue = await import("./sftpTransfers");
    const task = queue.enqueueSftpTransfer({ host: "example", direction: "upload", kind: "file", localPath: "/fixtures/file", remotePath: "/srv/file", label: "file" });
    const deactivate = queue.activateSftpTransferQueue("example", "reviewed-session");
    queue.resumeSftpTransfer(task.id, true);
    await vi.waitFor(() => expect(queue.getSftpTransfers("example")[0].state).toBe("completed"));
    expect(uploadFile).toHaveBeenCalledWith("reviewed-session", "/fixtures/file", "/srv/file", task.id, false, true);
    deactivate();
  });

  it("restores queued work as paused and connecting never automatically starts it", async () => {
    storage.setItem("huskv2.sftp.transferQueue", JSON.stringify([{
      id: "queued-before-restart", host: "example", direction: "upload", kind: "folder", localPath: "/fixtures/project", remotePath: "/srv", label: "project", state: "queued", progress: 0, attempts: 0, createdAt: 1, updatedAt: 1,
    }]));
    const queue = await import("./sftpTransfers");
    const deactivate = queue.activateSftpTransferQueue("example", "new-session");
    expect(queue.getSftpTransfers("example")[0].state).toBe("paused");
    expect(uploadFolder).not.toHaveBeenCalled();
    queue.resumeSftpTransfer("queued-before-restart");
    await vi.waitFor(() => expect(queue.getSftpTransfers("example")[0].state).toBe("completed"));
    expect(uploadFolder).toHaveBeenCalledWith("new-session", "/fixtures/project", "/srv", "queued-before-restart", false, "merge", false);
    deactivate();
  });

  it("deactivation pauses queued work, cancels running work, and prevents auto-resume on reconnect", async () => {
    let finish!: () => void;
    uploadFolder.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const queue = await import("./sftpTransfers");
    const deactivate = queue.activateSftpTransferQueue("example", "session-a");
    const input = { host: "example", direction: "upload" as const, kind: "folder" as const, localPath: "/fixtures/project", remotePath: "/srv", label: "project" };
    const first = queue.enqueueSftpTransfer(input);
    const second = queue.enqueueSftpTransfer(input);
    expect(queue.getSftpTransfers("example").find(task => task.id === first.id)?.state).toBe("running");
    expect(queue.getSftpTransfers("example").find(task => task.id === second.id)?.state).toBe("queued");
    deactivate();
    expect(queue.getSftpTransfers("example").every(task => task.state === "paused")).toBe(true);
    expect(cancelTransfer).toHaveBeenCalledExactlyOnceWith(first.id);
    queue.retrySftpTransfer(second.id);
    const closeNew = queue.activateSftpTransferQueue("example", "session-b");
    finish();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(uploadFolder).toHaveBeenCalledTimes(1);
    expect(queue.getSftpTransfers("example").every(task => task.state === "paused")).toBe(true);
    queue.resumeSftpTransfer(second.id);
    await vi.waitFor(() => expect(queue.getSftpTransfers("example").find(task => task.id === second.id)?.state).toBe("completed"));
    expect(uploadFolder).toHaveBeenLastCalledWith("session-b", "/fixtures/project", "/srv", second.id, false, "merge", false);
    closeNew();
  });

  it("does not let an older panel cleanup deactivate a newly confirmed session", async () => {
    const queue = await import("./sftpTransfers");
    const closeOld = queue.activateSftpTransferQueue("example", "old-session");
    const closeNew = queue.activateSftpTransferQueue("example", "new-session");
    closeOld();
    const task = queue.enqueueSftpTransfer({ host: "example", direction: "upload", kind: "file", localPath: "/fixtures/file", remotePath: "/srv/file", label: "file" });
    await vi.waitFor(() => expect(queue.getSftpTransfers("example")[0].state).toBe("completed"));
    expect(uploadFile).toHaveBeenCalledWith("new-session", "/fixtures/file", "/srv/file", task.id, false, false);
    expect(queue.getSftpTransfers("example")[0].host).toBe("example");
    closeNew();
  });

  it("does not let a cancelled connection's late failure erase a reviewed retry on the new connection", async () => {
    let rejectOld!: (error: Error) => void;
    uploadFile.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectOld = reject; }));
    const queue = await import("./sftpTransfers");
    const closeOld = queue.activateSftpTransferQueue("example", "old-session");
    const task = queue.enqueueSftpTransfer({ host: "example", direction: "upload", kind: "file", localPath: "/fixtures/file", remotePath: "/srv/file", label: "file" });
    closeOld();
    const closeNew = queue.activateSftpTransferQueue("example", "new-session");
    queue.resumeSftpTransfer(task.id);
    rejectOld(new Error("old connection cancelled"));
    await vi.waitFor(() => expect(queue.getSftpTransfers("example")[0].state).toBe("completed"));
    expect(uploadFile).toHaveBeenLastCalledWith("new-session", "/fixtures/file", "/srv/file", task.id, true, false);
    closeNew();
  });

  it.each(["file", "folder"] as const)("passes explicit replacement authority to a %s download only", async kind => {
    const queue = await import("./sftpTransfers");
    const deactivate = queue.activateSftpTransferQueue("example", "confirmed-session");
    const task = queue.enqueueSftpTransfer({ host: "example", direction: "download", kind, localPath: "/fixtures/target", remotePath: "/srv/file", label: "file", allowOverwrite: true });
    await vi.waitFor(() => expect(queue.getSftpTransfers("example")[0].state).toBe("completed"));
    expect(kind === "file" ? downloadFile : downloadFolder).toHaveBeenCalledWith("confirmed-session", "/srv/file", "/fixtures/target", task.id, false, true);
    deactivate();
  });

  it("cannot retry completed work or enqueue surprise work by retrying while disconnected", async () => {
    const queue = await import("./sftpTransfers");
    const task = queue.enqueueSftpTransfer({ host: "example", direction: "upload", kind: "file", localPath: "/fixtures/file", remotePath: "/srv/file", label: "file" });
    queue.retrySftpTransfer(task.id);
    const deactivate = queue.activateSftpTransferQueue("example");
    expect(uploadFile).not.toHaveBeenCalled();
    queue.resumeSftpTransfer(task.id);
    await vi.waitFor(() => expect(queue.getSftpTransfers("example")[0].state).toBe("completed"));
    queue.retrySftpTransfer(task.id);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    deactivate();
  });
});
