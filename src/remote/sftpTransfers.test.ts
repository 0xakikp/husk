import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cancelTransfer = vi.fn(() => Promise.resolve(true));
const uploadFolder = vi.fn(() => Promise.resolve());

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("./sftpApi", () => ({
  sftpCancelTransfer: cancelTransfer,
  sftpDownload: vi.fn(),
  sftpDownloadDir: vi.fn(),
  sftpUpload: vi.fn(),
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

  it("persists queued work and pauses it before asking the native backend to cancel", async () => {
    const queue = await import("./sftpTransfers");
    const task = queue.enqueueSftpTransfer({
      host: "example",
      direction: "upload",
      kind: "file",
      localPath: "/Users/me/build.zip",
      remotePath: "/srv/build.zip",
      label: "build.zip",
    });

    expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "queued" }]);
    expect(storage.getItem("huskv2.sftp.transferQueue")).toContain(task.id);

    queue.pauseSftpTransfer(task.id);

    expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "paused" }]);
    expect(cancelTransfer).toHaveBeenCalledWith(task.id);
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

    expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "queued", error: undefined }]);
    queue.removeSftpTransfer(task.id);
    expect(queue.getSftpTransfers("example")).toEqual([]);
  });

  it("persists the chosen folder conflict strategy through a retry", async () => {
    uploadFolder.mockRejectedValueOnce(new Error("connection lost"));
    const queue = await import("./sftpTransfers");
    const task = queue.enqueueSftpTransfer({
      host: "example",
      direction: "upload",
      kind: "folder",
      localPath: "/Users/me/project",
      remotePath: "/srv",
      label: "project",
      folderConflictStrategy: "replace",
    });

    const deactivate = queue.activateSftpTransferQueue("example");
    await vi.waitFor(() => {
      expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "failed" }]);
    });
    expect(uploadFolder).toHaveBeenLastCalledWith("example", "/Users/me/project", "/srv", task.id, false, "replace");

    queue.retrySftpTransfer(task.id);
    await vi.waitFor(() => {
      expect(queue.getSftpTransfers("example")).toMatchObject([{ id: task.id, state: "completed" }]);
    });
    expect(uploadFolder).toHaveBeenLastCalledWith("example", "/Users/me/project", "/srv", task.id, true, "replace");
    deactivate();
  });
});
