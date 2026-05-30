/** Simple toggle store for AiFloatingBubble from external triggers. */

let toggleFn: (() => void) | null = null;

export function registerBubbleToggle(fn: () => void): () => void {
  toggleFn = fn;
  return () => {
    if (toggleFn === fn) toggleFn = null;
  };
}

export function toggleBubble(): void {
  toggleFn?.();
}

/* ── Session switch requests ── */

let switchBubbleSubscribers: ((id: string) => void)[] = [];

export function subscribeBubbleSwitch(fn: (id: string) => void): () => void {
  switchBubbleSubscribers.push(fn);
  return () => {
    switchBubbleSubscribers = switchBubbleSubscribers.filter((f) => f !== fn);
  };
}

export function requestBubbleSwitch(id: string): void {
  switchBubbleSubscribers.forEach((fn) => fn(id));
}
