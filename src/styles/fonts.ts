export type FontFamilyId =
  | "jetbrains"
  | "sfmono"
  | "menlo"
  | "fira"
  | "cascadia"
  | "source"
  | "ibm"
  | "hack"
  | "system";

/** Monospace fonts offered for the terminal + editor. The stack falls back to
 *  Menlo/monospace so an uninstalled family still renders. */
export const FONT_FAMILIES: Record<FontFamilyId, { name: string; stack: string }> = {
  jetbrains: { name: "JetBrains Mono", stack: '"JetBrains Mono", Menlo, Monaco, monospace' },
  sfmono: { name: "SF Mono", stack: '"SF Mono", Menlo, Monaco, monospace' },
  menlo: { name: "Menlo", stack: "Menlo, Monaco, monospace" },
  fira: { name: "Fira Code", stack: '"Fira Code", Menlo, Monaco, monospace' },
  cascadia: { name: "Cascadia Code", stack: '"Cascadia Code", Menlo, Monaco, monospace' },
  source: { name: "Source Code Pro", stack: '"Source Code Pro", Menlo, Monaco, monospace' },
  ibm: { name: "IBM Plex Mono", stack: '"IBM Plex Mono", Menlo, Monaco, monospace' },
  hack: { name: "Hack", stack: 'Hack, Menlo, Monaco, monospace' },
  system: { name: "System monospace", stack: "ui-monospace, Menlo, Monaco, monospace" },
};

export function fontStack(id: FontFamilyId): string {
  return (FONT_FAMILIES[id] ?? FONT_FAMILIES.jetbrains).stack;
}
