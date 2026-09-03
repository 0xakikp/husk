import { invoke } from "@tauri-apps/api/core";

export type DirEntry = { name: string; path: string; is_dir: boolean };

export const readDir = (path: string) => invoke<DirEntry[]>("read_dir", { path });
export const readFile = (path: string) => invoke<string>("read_file", { path });
export const writeFile = (path: string, contents: string) =>
  invoke<void>("write_file", { path, contents });

/** AI file tools use these native-scoped variants. The selected chat workspace
    is checked again in Rust, including against symlink escapes. */
export const readDirScoped = (path: string, root: string) =>
  invoke<DirEntry[]>("read_dir_scoped", { path, root });
export const readFileScoped = (path: string, root: string) =>
  invoke<string>("read_file_scoped", { path, root });
export const writeFileScoped = (path: string, contents: string, root: string) =>
  invoke<void>("write_file_scoped", { path, contents, root });
export const writeNewFileScoped = (path: string, contents: string, root: string) =>
  invoke<void>("write_new_file_scoped", { path, contents, root });
export const deleteFileScoped = (path: string, root: string) =>
  invoke<void>("delete_file_scoped", { path, root });
export const createDirScoped = (path: string, root: string) =>
  invoke<void>("create_dir_scoped", { path, root });
export const homeDir = () => invoke<string>("home_dir");
export const getHomeDir = homeDir;

export const readFileBase64 = (path: string) =>
  invoke<string>("read_file_base64", { path });

export const writeBinaryFile = (path: string, contents: number[]) =>
  invoke<void>("write_binary_file", { path, contents });

export const createFile = (path: string) => invoke<void>("create_file", { path });
export const createDir = (path: string) => invoke<void>("create_dir", { path });
export const copyPath = (from: string, to: string) =>
  invoke<void>("copy_path", { from, to });
export const renamePath = (from: string, to: string) =>
  invoke<void>("rename_path", { from, to });
export const deletePath = (path: string) => invoke<void>("delete_path", { path });
