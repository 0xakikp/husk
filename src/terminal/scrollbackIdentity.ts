/** Stable archive identity, independent of recyclable pane and PTY numbers. */
export function createScrollbackKey(): string { return crypto.randomUUID(); }
export function isScrollbackKey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
