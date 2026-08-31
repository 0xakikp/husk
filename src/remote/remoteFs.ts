import { invoke } from "@tauri-apps/api/core";

export type DirEntry = { name: string; path: string; is_dir: boolean };

export const sshReadDir = (host: string, path: string) =>
  invoke<DirEntry[]>("ssh_read_dir", { host, path });

export const sshReadDirScoped = (host: string, root: string, path: string) =>
  invoke<DirEntry[]>("ssh_read_dir_scoped", { host, root, path });

export const sshReadFile = (host: string, path: string) =>
  invoke<string>("ssh_read_file", { host, path });

export const sshReadFileScoped = (host: string, root: string, path: string) =>
  invoke<string>("ssh_read_file_scoped", { host, root, path });

export const sshWriteFile = (host: string, path: string, contents: string) =>
  invoke<void>("ssh_write_file", { host, path, contents });

export const sshWriteFileScoped = (host: string, root: string, path: string, contents: string) =>
  invoke<void>("ssh_write_file_scoped", { host, root, path, contents });

export const sshCreateFileScoped = (host: string, root: string, path: string, contents: string) =>
  invoke<void>("ssh_create_file_scoped", { host, root, path, contents });

export const sshDeleteFileScoped = (host: string, root: string, path: string) =>
  invoke<void>("ssh_delete_file_scoped", { host, root, path });

export const sshCreateFile = (host: string, path: string) =>
  invoke<void>("ssh_create_file", { host, path });

export const sshCreateDir = (host: string, path: string) =>
  invoke<void>("ssh_create_dir", { host, path });

export const sshRenamePath = (host: string, from: string, to: string) =>
  invoke<void>("ssh_rename_path", { host, from, to });

export const sshDeletePath = (host: string, path: string) =>
  invoke<void>("ssh_delete_path", { host, path });

export const sshHomeDir = (host: string) =>
  invoke<string>("ssh_home_dir", { host });

export const sshPwd = (host: string) =>
  invoke<string>("ssh_pwd", { host });
