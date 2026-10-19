/** Fit priority-ordered entries using their rendered widths, not window breakpoints.
 * overflowWidths[n - 1] is the rendered width of the +n indicator. */
export function fitStatusTools(widths: readonly number[], available: number, gap: number, overflowWidths: readonly number[]): number {
  if (!widths.length) return 0;
  const prefix = [0];
  for (const width of widths) prefix.push(prefix[prefix.length - 1] + Math.max(0, width));
  if (prefix[widths.length] + gap * (widths.length - 1) <= available) return widths.length;
  for (let count = widths.length - 1; count >= 0; count--) {
    const overflow = overflowWidths[widths.length - count - 1] ?? 0;
    if (prefix[count] + gap * count + overflow <= available) return count;
  }
  return 0;
}
