/** Simple toggle store for AiFloatingBubble from external triggers. */

let toggleFn: (() => void) | null = null;
let openFn: ((text?: string) => void) | null = null;

export function registerBubbleToggle(fn: () => void): () => void {
  toggleFn = fn;
  return () => {
    if (toggleFn === fn) toggleFn = null;
  };
}

export function registerBubbleOpen(fn: (text?: string) => void): () => void {
  openFn = fn;
  return () => {
    if (openFn === fn) openFn = null;
  };
}

export function toggleBubble(): void {
  toggleFn?.();
}

export function openBubble(text?: string): void {
  openFn?.(text);
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
