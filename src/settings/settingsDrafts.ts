import { useId, useLayoutEffect, useSyncExternalStore } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { toast } from "../toast";

type Draft = { label: string; busy: boolean };
const drafts = new Map<string, Draft>();
const listeners = new Set<() => void>();
let snapshot: readonly Draft[] = [];
let confirmation: Promise<boolean> | null = null;

function publish() {
  snapshot = [...drafts.values()];
  for (const listener of listeners) listener();
}

export function registerSettingsDraft(id: string, draft: Draft): () => void {
  drafts.set(id, draft); publish();
  return () => { drafts.delete(id); publish(); };
}

/** Drafts stay in their editor until a save succeeds or discarding is explicit. */
export function useSettingsDraft(dirty: boolean, label: string, busy = false): void {
  const id = useId();
  useLayoutEffect(() => {
    if (!dirty && !busy) return;
    return registerSettingsDraft(id, { label, busy });
  }, [id, dirty, label, busy]);
}

export function useSettingsDraftState() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot);
}

/** Used by category changes, editor Back/Cancel, and the native window close. */
export async function confirmSettingsNavigation(): Promise<boolean> {
  if (!drafts.size) return true;
  if (snapshot.some((draft) => draft.busy)) {
    toast({ title: "Save in progress", message: "Please wait for the settings operation to finish.", variant: "info" });
    return false;
  }
  if (!confirmation) {
    confirmation = confirm(`Unsaved changes in ${[...new Set(snapshot.map((draft) => draft.label))].join(", ")}. Discard them and continue?`, {
      title: "Unsaved settings", kind: "warning", okLabel: "Discard changes", cancelLabel: "Keep editing",
    }).catch(() => false).finally(() => { confirmation = null; });
  }
  return confirmation;
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (!drafts.size) return;
    event.preventDefault(); event.returnValue = "";
  });
}
