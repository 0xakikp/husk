import { useSyncExternalStore } from "react";

const LS_KEY = "husk:clipboard-history";
const MAX_ITEMS = 200;

export type ClipItem = {
  id: string;
  text: string;
  createdAt: number;
};

let history: ClipItem[] = loadHistory();
const subscribers = new Set<() => void>();

function loadHistory(): ClipItem[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((it): it is ClipItem =>
          typeof it === "object" &&
          it !== null &&
          typeof (it as ClipItem).id === "string" &&
          typeof (it as ClipItem).text === "string" &&
          typeof (it as ClipItem).createdAt === "number"
        )
        .slice(0, MAX_ITEMS);
    }
  } catch {
    // ignore corrupt storage
  }
  return [];
}

function saveHistory(): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(history));
  } catch {
    // storage full or unavailable
  }
}

function emit() {
  for (const fn of subscribers) fn();
}

export function pushClip(text: string): void {
  if (!text || !text.trim()) return;
  const trimmed = text.trim();
  if (history[0]?.text === trimmed) return;
  const item: ClipItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    text: trimmed,
    createdAt: Date.now(),
  };
  history = [item, ...history.filter((t) => t.text !== trimmed)].slice(0, MAX_ITEMS);
  saveHistory();
  emit();
}

export function deleteClip(id: string): void {
  history = history.filter((t) => t.id !== id);
  saveHistory();
  emit();
}

export function clearClips(): void {
  history = [];
  saveHistory();
  emit();
}

export function getClips(): ClipItem[] {
  return history;
}

export function useClipHistory(): ClipItem[] {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => history,
  );
}
