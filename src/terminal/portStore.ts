import { useSyncExternalStore } from "react";

export type PortRecord = {
  leafId: number;
  command: string;
  urls: string[];
  at: number;
};

const ports = new Map<number, PortRecord>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const listener of subscribers) listener();
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, "");
}

function trimUrl(value: string): string {
  /* Keep the closing bracket in http://[::1]:3000 intact. */
  return value.replace(/[),.;!?}]+$/, "");
}

/**
 * Pull local dev-server URLs from terminal output. We require either a known
 * server command or server-like language in the output so `curl localhost`
 * and documentation examples do not create misleading endpoint controls.
 */
export function extractLocalDevUrls(command: string, output: string): string[] {
  const clean = stripAnsi(output);
  const hasServerSignal = /\b(?:local|listening|listens|ready|started|serving|server|available|dev server)\b/i.test(clean);
  const hasServerCommand = /\b(?:vite|next\s+dev|nuxt|astro|webpack(?:\s+serve)?|parcel|serve\b|dev\b|python(?:3)?\s+-m\s+http\.server|go\s+run|docker\s+compose\s+up)\b/i.test(command);
  if (!hasServerSignal && !hasServerCommand) return [];

  const pattern = /https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d{2,5})?(?:\/[^\s'"<>]*)?/gi;
  const urls = new Set<string>();
  for (const match of clean.matchAll(pattern)) {
    const candidate = trimUrl(match[0]);
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1" || hostname.startsWith("127.")) {
        urls.add(candidate);
      }
    } catch {
      // A partial URL in an in-flight terminal chunk is ignored until complete.
    }
  }
  return [...urls].slice(0, 4);
}

export function recordPorts(
  leafId: number,
  fields: { command: string; urls: string[]; at?: number },
): void {
  const urls = [...new Set(fields.urls)];
  if (urls.length === 0) return;
  const previous = ports.get(leafId);
  const merged = [...new Set([...(previous?.urls ?? []), ...urls])].slice(0, 4);
  if (
    previous &&
    previous.command === (fields.command || previous.command) &&
    previous.urls.length === merged.length &&
    previous.urls.every((url, index) => url === merged[index])
  ) {
    return;
  }
  ports.set(leafId, {
    leafId,
    command: fields.command || previous?.command || "",
    urls: merged,
    at: fields.at ?? Date.now(),
  });
  emit();
}

export function clearPorts(leafId: number): void {
  if (ports.delete(leafId)) emit();
}

export function getPorts(leafId: number): PortRecord | null {
  return ports.get(leafId) ?? null;
}

export function subscribePorts(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function usePorts(leafId: number | null): PortRecord | null {
  return useSyncExternalStore(
    subscribePorts,
    () => (leafId == null ? null : getPorts(leafId)),
  );
}
