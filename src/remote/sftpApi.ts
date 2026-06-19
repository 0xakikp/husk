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

export const sftpDownload = (host: string, remotePath: string, localPath: string) =>
  invoke<void>("sftp_download", { host, remotePath, localPath });

export const sftpUpload = (host: string, localPath: string, remotePath: string) =>
  invoke<void>("sftp_upload", { host, localPath, remotePath });

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
