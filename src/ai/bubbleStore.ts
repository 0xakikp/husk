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
  // Floating bubble is retired; redirect to inline composer.
  openComposer(text);
}

/* ── Composer toggle requests ── */

const composerToggleFns: Array<() => void> = [];
const composerOpenFns: Array<(text?: string) => void> = [];

export function registerComposerToggle(fn: () => void): () => void {
  composerToggleFns.push(fn);
  return () => {
    const idx = composerToggleFns.indexOf(fn);
    if (idx >= 0) composerToggleFns.splice(idx, 1);
  };
}

export function registerComposerOpen(fn: (text?: string) => void): () => void {
  composerOpenFns.push(fn);
  return () => {
    const idx = composerOpenFns.indexOf(fn);
    if (idx >= 0) composerOpenFns.splice(idx, 1);
  };
}

export function toggleComposer(): void {
  composerToggleFns.forEach((fn) => fn());
}

export function openComposer(text?: string): void {
  composerOpenFns.forEach((fn) => fn(text));
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
