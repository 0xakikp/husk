import { getPrefs, setPrefs, type Prefs } from "./preferences";

/** The appearance-only slice of Prefs a preset is allowed to set. */
type AppearancePrefs = Pick<
  Prefs,
  | "theme"
  | "accentColor"
  | "animationsEnabled"
  | "frostedGlass"
  | "neonBorderGlow"
  | "panelGaps"
  | "panelGapStyle"
  | "panelShadows"
  | "activePanelGlow"
  | "editorWallpaperOpacity"
  | "aiMiniOpacity"
  | "aiMiniFontSize"
  | "aiMiniBgBlur"
  | "aiMiniBgDim"
  | "aiComposerBgStyle"
  | "aiComposerBgColor"
>;

export type AppearancePreset = {
  id: string;
  name: string;
  description: string;
  prefs: Partial<AppearancePrefs>;
  /** Wallpaper knobs. `path` is deliberately absent — see applyAppearancePreset. */
  background?: Partial<Omit<Prefs["background"], "path">>;
  custom?: boolean;
};

const BUILTIN: AppearancePreset[] = [
  {
    id: "husk",
    name: "Husk",
    description: "the shipped look — flat, no gaps, no wallpaper effects",
    prefs: {
      accentColor: "#11c700",
      animationsEnabled: true,
      frostedGlass: false,
      neonBorderGlow: false,
      panelGaps: 0,
      panelGapStyle: "none",
      panelShadows: false,
      activePanelGlow: false,
      editorWallpaperOpacity: 0,
      aiMiniOpacity: 48,
      aiMiniBgBlur: 0,
      aiMiniBgDim: 50,
      aiComposerBgStyle: "default",
    },
    background: { enabled: false, opacity: 100, blur: 0 },
  },
  {
    id: "kath",
    name: "Kath",
    description: "atmospheric — wallpaper, frosted panels, glow and gaps",
    prefs: {
      animationsEnabled: true,
      frostedGlass: true,
      neonBorderGlow: true,
      panelGaps: 10,
      panelGapStyle: "dots",
      panelShadows: true,
      activePanelGlow: true,
      editorWallpaperOpacity: 18,
      aiMiniOpacity: 38,
      aiMiniBgBlur: 12,
      aiMiniBgDim: 62,
      aiComposerBgStyle: "default",
    },
    background: { enabled: true, opacity: 27, blur: 2 },
  },
];

/**
 * Apply a preset.
 *
 * setPrefs is a SHALLOW merge, so assigning `background` wholesale would discard
 * the sibling keys in it — including `path`, the user's chosen wallpaper image. A
 * preset ships settings, not an image, so the current background is spread first
 * and only the knobs the preset names are overwritten.
 */
export function applyAppearancePreset(preset: AppearancePreset): void {
  const patch: Partial<Prefs> = { ...preset.prefs };
  if (preset.background) {
    patch.background = { ...getPrefs().background, ...preset.background };
  }
  setPrefs(patch);
}

/* ── Custom presets ────────────────────────────────────────────────────────
   Kept in their own localStorage key rather than inside Prefs, so capturing a
   preset never becomes part of the value a preset can set. */

const LS_KEY = "husk.appearance.presets";

const APPEARANCE_KEYS: (keyof AppearancePrefs)[] = [
  "accentColor",
  "animationsEnabled",
  "frostedGlass",
  "neonBorderGlow",
  "panelGaps",
  "panelGapStyle",
  "panelShadows",
  "activePanelGlow",
  "editorWallpaperOpacity",
  "aiMiniOpacity",
  "aiMiniFontSize",
  "aiMiniBgBlur",
  "aiMiniBgDim",
  "aiComposerBgStyle",
  "aiComposerBgColor",
];

export function getCustomPresets(): AppearancePreset[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AppearancePreset[]) : [];
  } catch {
    return [];
  }
}

function writeCustomPresets(list: AppearancePreset[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — nothing useful to do
  }
}

/** Snapshot the current appearance under a name. Overwrites a same-named preset. */
export function saveCurrentAsPreset(name: string): AppearancePreset | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const p = getPrefs();
  const prefs: Partial<AppearancePrefs> = {};
  for (const k of APPEARANCE_KEYS) {
    (prefs as Record<string, unknown>)[k] = p[k];
  }
  const preset: AppearancePreset = {
    id: `custom:${trimmed.toLowerCase().replace(/\s+/g, "-")}`,
    name: trimmed,
    description: "your saved appearance",
    prefs,
    // Wallpaper knobs travel, the image path does not: it is specific to this
    // machine, and applyAppearancePreset preserves whatever path is set.
    background: {
      enabled: p.background.enabled,
      opacity: p.background.opacity,
      blur: p.background.blur,
    },
    custom: true,
  };
  const next = [...getCustomPresets().filter((x) => x.id !== preset.id), preset];
  writeCustomPresets(next);
  return preset;
}

export function deleteCustomPreset(id: string): void {
  writeCustomPresets(getCustomPresets().filter((p) => p.id !== id));
}

export function allPresets(): AppearancePreset[] {
  return [...BUILTIN, ...getCustomPresets()];
}
