/** JSON is deliberate: whitespace splitting loses quoted paths and even a
 * one-argument-per-line editor cannot round-trip newlines or empty arguments. */
export function formatMcpArguments(args: string[]): string {
  return JSON.stringify(args, null, 2);
}

export function parseMcpArguments(input: string): string[] {
  let value: unknown;
  try { value = JSON.parse(input); }
  catch { throw new Error('Arguments must be a JSON array of strings, for example ["--folder", "/My Project"].'); }
  if (!Array.isArray(value) || value.length > 1024 || value.some((item) => typeof item !== "string" || item.includes("\0"))) throw new Error("Arguments must be an array of strings without null characters (maximum 1,024 arguments).");
  if (input.length > 128_000) throw new Error("Arguments exceed the 128 KB limit.");
  return value as string[];
}
