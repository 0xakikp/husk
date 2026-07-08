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

let composerToggleFn: (() => void) | null = null;
let composerOpenFn: ((text?: string) => void) | null = null;

export function registerComposerToggle(fn: () => void): () => void {
  composerToggleFn = fn;
  return () => {
    if (composerToggleFn === fn) composerToggleFn = null;
  };
}

export function registerComposerOpen(fn: (text?: string) => void): () => void {
  composerOpenFn = fn;
  return () => {
    if (composerOpenFn === fn) composerOpenFn = null;
  };
}

export function toggleComposer(): void {
  composerToggleFn?.();
}

export function openComposer(text?: string): void {
  composerOpenFn?.(text);
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
