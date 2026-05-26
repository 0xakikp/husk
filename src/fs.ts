import { invoke } from "@tauri-apps/api/core";

export type DirEntry = { name: string; path: string; is_dir: boolean };

export const readDir = (path: string) => invoke<DirEntry[]>("read_dir", { path });
export const readFile = (path: string) => invoke<string>("read_file", { path });
export const writeFile = (path: string, contents: string) =>
  invoke<void>("write_file", { path, contents });
export const homeDir = () => invoke<string>("home_dir");

export const readFileBase64 = (path: string) =>
  invoke<string>("read_file_base64", { path });

export const createFile = (path: string) => invoke<void>("create_file", { path });
export const createDir = (path: string) => invoke<void>("create_dir", { path });
export const renamePath = (from: string, to: string) =>
  invoke<void>("rename_path", { from, to });
export const deletePath = (path: string) => invoke<void>("delete_path", { path });
