import { invoke } from "@tauri-apps/api/core";

export interface SftpEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number;
}

export const sftpConnect = (host: string) =>
  invoke<boolean>("sftp_connect", { host });

export const sftpListDir = (host: string, path: string) =>
  invoke<SftpEntry[]>("sftp_list_dir", { host, path });

export const sftpDownload = (
  host: string,
  remotePath: string,
  localPath: string,
  transferId: string,
  resume = true,
) => invoke<void>("sftp_download", { host, remotePath, localPath, transferId, resume });

/** Recursively downloads a remote folder into the chosen local parent folder. */
export const sftpDownloadDir = (
  host: string,
  remotePath: string,
  localParent: string,
  transferId: string,
  resume = true,
) => invoke<void>("sftp_download_dir", { host, remotePath, localParent, transferId, resume });

export const sftpUpload = (
  host: string,
  localPath: string,
  remotePath: string,
  transferId: string,
  resume = true,
) => invoke<void>("sftp_upload", { host, localPath, remotePath, transferId, resume });

/** Recursively uploads a chosen local folder into the current remote folder. */
export const sftpUploadDir = (
  host: string,
  localPath: string,
  remoteParent: string,
  transferId: string,
  resume = true,
  conflictMode: "merge" | "replace" = "merge",
) => invoke<void>("sftp_upload_dir", { host, localPath, remoteParent, transferId, resume, conflictMode });

export const sftpCancelTransfer = (transferId: string) =>
  invoke<boolean>("sftp_transfer_cancel", { transferId });

/** Copies a remote file or folder, including a folder's contents. */
export const sftpCopy = (host: string, from: string, to: string) =>
  invoke<void>("sftp_copy", { host, from, to });

/** Removes a remote file or folder and all of that folder's contents. */
export const sftpDeleteRecursive = (host: string, path: string) =>
  invoke<void>("sftp_delete_recursive", { host, path });

export const sftpMkdir = (host: string, path: string) =>
  invoke<void>("sftp_mkdir", { host, path });

export const sftpRename = (host: string, from: string, to: string) =>
  invoke<void>("sftp_rename", { host, from, to });

export const sftpDelete = (host: string, path: string, isDir?: boolean) =>
  invoke<void>(isDir ? "sftp_rmdir" : "sftp_delete", { host, path });

export const sftpRmdir = (host: string, path: string) =>
  invoke<void>("sftp_rmdir", { host, path });

export const sftpStat = (host: string, path: string) =>
  invoke<SftpEntry>("sftp_stat", { host, path });

export const sftpDisconnect = (host: string) =>
  invoke<void>("sftp_disconnect", { host });
