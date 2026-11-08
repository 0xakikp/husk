/** External requests target the active composer; the old floating bubble
 * implementation has been retired. Preserve its open alias for callers. */

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

/* ── Composer send requests ── */

const composerSendFns: Array<(text: string) => void> = [];

export function registerComposerSend(fn: (text: string) => void): () => void {
  composerSendFns.push(fn);
  return () => {
    const idx = composerSendFns.indexOf(fn);
    if (idx >= 0) composerSendFns.splice(idx, 1);
  };
}

export function sendToComposer(text: string): void {
  composerSendFns.forEach((fn) => fn(text));
}

export function openComposer(text?: string): void {
  composerOpenFns.forEach((fn) => fn(text));
}
