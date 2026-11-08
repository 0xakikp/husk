/**
 * Catch illustrative shell arguments such as `<package>` before execution.
 * This is deliberately a small lexical check, not a shell parser: only whole,
 * unquoted, unescaped angle tokens with a name/path-shaped body are considered.
 * It does not interpret substitutions, nested programs, or arbitrary templates.
 * Ordinary one-sided/spaced redirection and comparison operators are untouched.
 */
export function commandPlaceholderError(text: string): string | null {
  let quote: "'" | '"' | "`" | null = null;
  let comparisonEnd: "]]" | "))" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && quote !== "'") { i++; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    const previous = text[i - 1];
    const wordStart = i === 0 || /[\s;&|()]/.test(previous);
    // `<name>` can be two adjacent comparison operators inside an arithmetic
    // expression, not an illustrative argument (e.g. (( a <b> c ))).
    if (comparisonEnd) {
      if (text.slice(i, i + 2) === comparisonEnd) { comparisonEnd = null; i++; }
      continue;
    }
    if (text.slice(i, i + 2) === "((" || (wordStart && text.slice(i, i + 2) === "[[")) {
      comparisonEnd = ch === "(" ? "))" : "]]";
      i++;
      continue;
    }
    if (ch === "#" && wordStart) {
      const nextLine = text.indexOf("\n", i);
      if (nextLine === -1) break;
      i = nextLine;
      continue;
    }
    if (ch !== "<" || (!wordStart && previous !== "=")) continue;
    const match = text.slice(i).match(/^<([A-Za-z_][A-Za-z0-9_./:-]{0,255})>/);
    if (!match) continue;
    const next = text[i + match[0].length];
    if (next !== undefined && !/[\s;&|()]/.test(next)) continue;
    return `Replace example placeholder ${match[0]} before running. In a workflow, use {{package}} (or another named input) to ask for a value at run time.`;
  }
  return null;
}
