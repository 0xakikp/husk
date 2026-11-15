import { invoke } from "@tauri-apps/api/core";
import { onFileChanged } from "./editor/fileChanges";

export type DirEntry = { name: string; path: string; is_dir: boolean; is_symlink?: boolean };

/** Mutations can partially succeed before rejecting (e.g. a bounded copy).
 * Always invalidate local views after settlement, without masking native errors. */
async function mutate(command: string, args: Record<string, unknown>, paths: string[]): Promise<void> {
  try {
    await invoke<void>(command, args);
  } finally {
    for (const path of new Set(paths)) onFileChanged(path);
  }
}

export const readDir = (path: string) => invoke<DirEntry[]>("read_dir", { path });
export const readFile = (path: string) => invoke<string>("read_file", { path });
export const writeFile = (path: string, contents: string) =>
  mutate("write_file", { path, contents }, [path]);

/** AI file tools use these native-scoped variants. The selected chat workspace
    is checked again in Rust, including against symlink escapes. */
export const readDirScoped = (path: string, root: string) =>
  invoke<DirEntry[]>("read_dir_scoped", { path, root });
export const readFileScoped = (path: string, root: string, maxBytes?: number) =>
  invoke<string>("read_file_scoped", { path, root, ...(maxBytes === undefined ? {} : { maxBytes }) });
export const writeFileScoped = (path: string, contents: string, root: string) =>
  mutate("write_file_scoped", { path, contents, root }, [path]);
export const writeNewFileScoped = (path: string, contents: string, root: string) =>
  mutate("write_new_file_scoped", { path, contents, root }, [path]);
export const deleteFileScoped = (path: string, root: string) =>
  mutate("delete_file_scoped", { path, root }, [path]);
export const createDirScoped = (path: string, root: string) =>
  mutate("create_dir_scoped", { path, root }, [path]);
export const homeDir = () => invoke<string>("home_dir");
export const getHomeDir = homeDir;

export const readFileBase64 = (path: string) =>
  invoke<string>("read_file_base64", { path });

export const writeBinaryFile = (path: string, contents: number[]) =>
  mutate("write_binary_file", { path, contents }, [path]);

export const createFile = (path: string) => mutate("create_file", { path }, [path]);
export const createDir = (path: string) => mutate("create_dir", { path }, [path]);
export const copyPath = (from: string, to: string) =>
  mutate("copy_path", { from, to }, [to]);
export const renamePath = (from: string, to: string) =>
  mutate("rename_path", { from, to }, [from, to]);
export const deletePath = (path: string) => mutate("delete_path", { path }, [path]);
/** Recoverable local deletion; never silently falls back to permanent deletion. */
export const trashPath = (path: string) => mutate("trash_path", { path }, [path]);
