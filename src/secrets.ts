import { invoke } from "@tauri-apps/api/core";

// One service namespace for all of huskv2's secrets; `account` is the key name
// (e.g. an AI provider id).
const SERVICE = "huskv2";

export const secretsGet = (account: string) =>
  invoke<string | null>("secrets_get", { service: SERVICE, account });

export const secretsSet = (account: string, password: string) =>
  invoke<void>("secrets_set", { service: SERVICE, account, password });

export const secretsDelete = (account: string) =>
  invoke<void>("secrets_delete", { service: SERVICE, account });

export const secretsGetAll = (accounts: string[]) =>
  invoke<(string | null)[]>("secrets_get_all", { service: SERVICE, accounts });
