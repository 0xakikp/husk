import { useSyncExternalStore } from "react";

const LS_KEY = "huskv2.ssh.activeHost";

let activeHost: string | null = null;
try {
  activeHost = localStorage.getItem(LS_KEY);
} catch {
  activeHost = null;
}

const subscribers = new Set<() => void>();

export function getActiveSshHost(): string | null {
  return activeHost;
}

export function setActiveSshHost(host: string | null): void {
  activeHost = host;
  try {
    if (host) {
      localStorage.setItem(LS_KEY, host);
    } else {
      localStorage.removeItem(LS_KEY);
    }
  } catch {
    // ignore
  }
  for (const fn of subscribers) fn();
}

export function useActiveSshHost(): string | null {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => activeHost,
  );
}

export function subscribeSshHost(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
