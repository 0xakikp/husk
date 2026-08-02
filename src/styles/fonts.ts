export type FontFamilyId =
  | "jetbrains"
  | "meslo"
  | "fira"
  | "source"
  | "cascadia"
  | "plex"
  | "iosevka"
  | "hack"
  | "glasstty"
  | "system";

type FontFamily = {
  name: string;
  stack: string;
  /** False when the app ships no faces for this family, so picking it only
   *  works if the user installed it themselves. The picker says so rather than
   *  letting the choice silently fall through to the next font in the stack. */
  bundled: boolean;
};

/**
 * Monospace families offered for the terminal + editor.
 *
 * Every stack names the **Nerd Font patched** build of the family before the
 * plain one. Patched builds carry the original glyphs plus the Powerline /
 * Devicons / Font Awesome private-use ranges, so anyone who has one installed
 * gets starship, neofetch and tmux icons with no fallback and no metric
 * mismatch. The plain (bundled) face is next, so the picker still works when no
 * patched build is present — `fontStack()` then appends a detected Nerd Font to
 * supply just the icon codepoints.
 *
 * "Nerd Font Mono" comes before "Nerd Font": the Mono builds keep icons at a
 * single cell width, which is what a terminal grid needs. The wide variants
 * overflow into the neighbouring column.
 */
export const FONT_FAMILIES: Record<FontFamilyId, FontFamily> = {
  jetbrains: {
    name: "JetBrains Mono",
    stack: '"JetBrainsMono Nerd Font Mono", "JetBrainsMono Nerd Font", "JetBrains Mono", monospace',
    bundled: true,
  },
  meslo: {
    name: "MesloLGL Nerd Font",
    stack:
      '"MesloLGL Nerd Font Mono", "MesloLGL Nerd Font", "MesloLGM Nerd Font", "MesloLGS Nerd Font", "MesloLGS NF", "MesloLGLDZ Nerd Font", "JetBrains Mono", monospace',
    // MesloLGL Nerd Font Mono ships in public/fonts as TTFs — see fonts.css.
    // It is also the app's universal icon fallback, so every other family here
    // gets Powerline/Devicons glyphs even with no patched build installed.
    bundled: true,
  },
  fira: {
    name: "Fira Code",
    stack: '"FiraCode Nerd Font Mono", "FiraCode Nerd Font", "Fira Code Variable", "Fira Code", monospace',
    bundled: true,
  },
  source: {
    name: "Source Code Pro",
    stack: '"SauceCodePro Nerd Font Mono", "SauceCodePro Nerd Font", "Source Code Pro Variable", "Source Code Pro", monospace',
    bundled: true,
  },
  cascadia: {
    name: "Cascadia Code",
    stack: '"CaskaydiaCove Nerd Font Mono", "CaskaydiaMono Nerd Font", "CaskaydiaCove Nerd Font", "Cascadia Code", monospace',
    bundled: true,
  },
  plex: {
    name: "IBM Plex Mono",
    // Nerd Fonts renames the patched IBM Plex Mono to "BlexMono".
    stack: '"BlexMono Nerd Font Mono", "BlexMono Nerd Font", "IBM Plex Mono", monospace',
    bundled: true,
  },
  iosevka: {
    name: "Iosevka",
    stack: '"Iosevka Nerd Font Mono", "Iosevka Term Nerd Font", "Iosevka Nerd Font", "Iosevka", monospace',
    bundled: true,
  },
  hack: {
    name: "Hack",
    stack: '"Hack Nerd Font Mono", "Hack Nerd Font", "Hack", monospace',
    bundled: true,
  },
  glasstty: {
    name: "Glass TTY VT220",
    // A DEC VT220 screen-font revival: no ligatures, no icons, and no patched
    // build exists. The appended Nerd Font is the only icon source here.
    stack: '"Glass TTY VT220", "Glass_TTY_VT220", "GlassTTYVT220", monospace',
    bundled: false,
  },
  system: { name: "System monospace", stack: "ui-monospace, Menlo, Monaco, monospace", bundled: true },
};

/** Patched builds worth probing for, in rough order of how common they are. */
const NERD_FONT_CANDIDATES = [
  "MesloLGL Nerd Font Mono",
  "MesloLGM Nerd Font",
  "MesloLGS NF",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMono Nerd Font",
  "JetBrainsMonoNL Nerd Font",
  "FiraCode Nerd Font Mono",
  "FiraCode Nerd Font",
  "Hack Nerd Font Mono",
  "Hack Nerd Font",
  "CaskaydiaCove Nerd Font Mono",
  "CaskaydiaMono Nerd Font",
  "CaskaydiaCove Nerd Font",
  "BlexMono Nerd Font Mono",
  "BlexMono Nerd Font",
  "Iosevka Nerd Font Mono",
  "Iosevka Term Nerd Font",
  "Iosevka Nerd Font",
  "SauceCodePro Nerd Font Mono",
  "SauceCodePro Nerd Font",
  "Hasklug Nerd Font",
  "Symbols Nerd Font Mono",
  "Symbols Nerd Font",
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

/** Every quoted family name in a stack, in order. */
function quotedFamilies(stack: string): string[] {
  return Array.from(stack.matchAll(/"([^"]+)"/g), (m) => m[1]);
}

/**
 * Whether picking this family will actually change what you see. Bundled
 * families always will. The rest depend on a manual install, and without this
 * check the picker would offer a choice that renders as the next font in the
 * stack with no explanation.
 */
export function isFamilyInstalled(id: FontFamilyId): boolean {
  const f = FONT_FAMILIES[id];
  if (!f || f.bundled) return true;
  if (typeof document === "undefined" || !document.fonts) return true;
  return quotedFamilies(f.stack).some((n) => {
    try {
      return document.fonts.check(`12px "${n}"`);
    } catch {
      return false;
    }
  });
}

export function fontStack(id: FontFamilyId): string {
  const chosen = FONT_FAMILIES[id] ?? FONT_FAMILIES.jetbrains;
  if (id === "system") return chosen.stack;
  /* The detected Nerd Font is APPENDED, never prepended. font-family resolves
     per glyph, so trailing it supplies only the codepoints the chosen face
     lacks — the icons — while letters still come from the font that was picked.
     Prepending it (what this used to do) meant that on any machine with a Nerd
     Font installed, that font won every glyph it had and the picker silently
     did nothing: choosing Fira Code rendered Meslo. */
  const base = chosen.stack.replace(/,\s*monospace\s*$/, "");
  return `${base}, ${detectMonoFontFamily()}`;
}
