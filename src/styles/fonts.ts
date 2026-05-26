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

/** Detect any installed Nerd Font and prepend it to the fallback chain. */
const NERD_FONT_CANDIDATES = [
  "MesloLGL Nerd Font Mono",
  "MesloLGM Nerd Font",
  "MesloLGS NF",
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMonoNL Nerd Font",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "Hack Nerd Font",
  "Hack Nerd Font Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaMono Nerd Font",
  "Iosevka Nerd Font",
  "Iosevka Term Nerd Font",
  "SauceCodePro Nerd Font",
  "Hasklug Nerd Font",
];

const FALLBACK_CHAIN = '"MesloLGL Nerd Font Mono", "JetBrains Mono", SFMono-Regular, Menlo, monospace';

let detected: string | null = null;

export function detectMonoFontFamily(): string {
  if (detected) return detected;
  if (typeof document === "undefined" || !document.fonts) {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  for (const f of NERD_FONT_CANDIDATES) {
    try {
      if (document.fonts.check(`12px "${f}"`)) {
        detected = `"${f}", ${FALLBACK_CHAIN}`;
        return detected;
      }
    } catch {
      // Some browsers throw on invalid font shorthand; ignore.
    }
  }
  detected = FALLBACK_CHAIN;
  return detected;
}

export function fontStack(id: FontFamilyId): string {
  const chosen = FONT_FAMILIES[id] ?? FONT_FAMILIES.jetbrains;
  // If the chosen stack already includes MesloLGL Nerd Font, return as-is.
  // Otherwise prepend detected Nerd Font for maximum glyph coverage.
  if (chosen.stack.includes("Nerd Font") || id === "system") {
    return chosen.stack;
  }
  return `${detectMonoFontFamily()}, ${chosen.stack}`;
}
