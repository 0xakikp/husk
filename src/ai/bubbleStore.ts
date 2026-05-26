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
