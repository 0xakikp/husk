export type FontFamilyId =
  | "jetbrains"
  | "meslo"
  | "fira"
  | "source"
  | "cascadia"
  | "system";

/** Monospace families offered for the terminal + editor — the same set husk v1
 *  ships (bundled via @fontsource), with MesloLGL Nerd Font as a system option
 *  for ligatures/glyphs. Stacks fall back to JetBrains Mono / monospace. */
export const FONT_FAMILIES: Record<FontFamilyId, { name: string; stack: string }> = {
  jetbrains: { name: "JetBrains Mono", stack: '"JetBrains Mono", "MesloLGL Nerd Font Mono", monospace' },
  meslo: {
    name: "MesloLGL Nerd Font",
    stack:
      '"MesloLGL Nerd Font Mono", "MesloLGL Nerd Font", "MesloLGM Nerd Font", "MesloLGS Nerd Font", "MesloLGS NF", "MesloLGLDZ Nerd Font", "JetBrains Mono", monospace',
  },
  fira: { name: "Fira Code", stack: '"Fira Code Variable", "JetBrains Mono", monospace' },
  source: { name: "Source Code Pro", stack: '"Source Code Pro Variable", "JetBrains Mono", monospace' },
  cascadia: { name: "Cascadia Code", stack: '"Cascadia Code", "JetBrains Mono", monospace' },
  system: { name: "System monospace", stack: "ui-monospace, Menlo, Monaco, monospace" },
};

export function fontStack(id: FontFamilyId): string {
  return (FONT_FAMILIES[id] ?? FONT_FAMILIES.jetbrains).stack;
}
