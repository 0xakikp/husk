import { invoke } from "@tauri-apps/api/core";

export type PortListener = {
  port: number;
  pid: number;
  command: string;
  address: string;
};

/** Lists TCP listeners on this device. No network request is made. */
export const listPorts = () => invoke<PortListener[]>("ports_list");

/** Sends SIGTERM to a selected local process. The operating system enforces ownership. */
export const stopPortProcess = (pid: number, port: number) => invoke<void>("ports_stop", { pid, port });
