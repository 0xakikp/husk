import { useSyncExternalStore } from "react";

const subscribers = new Set<() => void>();
const connectedHosts = new Set<string>();

export function markHostConnected(host: string): void {
  connectedHosts.add(host);
  for (const fn of subscribers) fn();
}

export function markHostDisconnected(host: string): void {
  connectedHosts.delete(host);
  for (const fn of subscribers) fn();
}

export function isHostConnected(host: string): boolean {
  return connectedHosts.has(host);
}

export function getConnectedHosts(): string[] {
  return Array.from(connectedHosts);
}

export function useConnectedHosts(): string[] {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => getConnectedHosts(),
  );
}
