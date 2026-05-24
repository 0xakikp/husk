import { useSyncExternalStore } from "react";

let history: string[] = [];
const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
}

export function pushClip(text: string): void {
  if (!text || history[0] === text) return;
  history = [text, ...history.filter((t) => t !== text)].slice(0, 50);
  emit();
}

export function clearClips(): void {
  history = [];
  emit();
}

export function useClipHistory(): string[] {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => history,
  );
}
