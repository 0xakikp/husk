import { readDir } from "../fs";
import { getPrefs, setPrefs } from "./preferences";

/**
 * Wallpaper folder support.
 *
 * `background.path` is a single image chosen in settings. Pointing `background.dir`
 * at a folder as well turns that into a set you can move through — from the
 * launcher, or with a keystroke, without opening settings at all.
 *
 * The folder never overrides `path`: `path` stays the single source of truth for
 * what is on screen, and cycling just rewrites it. So a folder can be set and
 * ignored, and picking a one-off image outside the folder still works.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const BUILT_IN_PREFIX = "husk:wallpaper/";

export type BuiltInWallpaper = {
  id: string;
  name: string;
  description: string;
  src: string;
};

/**
 * Wallpaper art that ships with Husk. `background.path` normally holds an
 * absolute local path, so built-ins use a small reserved identifier instead.
 * That lets existing folder browsing and local-image behaviour remain exactly
 * as it is while App can resolve bundled art without asking Rust to read it.
 */
export const BUILT_IN_WALLPAPERS: readonly BuiltInWallpaper[] = [
  {
    id: "midnight-circuit",
    name: "Midnight Circuit",
    description: "Emerald traces at the edge of a quiet console.",
    src: `${import.meta.env.BASE_URL}wallpapers/husk-midnight-circuit.png`,
  },
  {
    id: "signal-bloom",
    name: "Signal Bloom",
    description: "Sparse green nodes, with room to think.",
    src: `${import.meta.env.BASE_URL}wallpapers/husk-signal-bloom.png`,
  },
  {
    id: "deep-space-console",
    name: "Deep Space Console",
    description: "Dim telemetry arcs in a deep night sky.",
    src: `${import.meta.env.BASE_URL}wallpapers/husk-deep-space-console.png`,
  },
  {
    id: "monolith",
    name: "Monolith",
    description: "Dark geometry with a measured signal edge.",
    src: `${import.meta.env.BASE_URL}wallpapers/husk-monolith.png`,
  },
];

export function builtInWallpaperPath(id: string): string {
  return `${BUILT_IN_PREFIX}${id}`;
}

export function getBuiltInWallpaper(path: string): BuiltInWallpaper | undefined {
  if (!path.startsWith(BUILT_IN_PREFIX)) return undefined;
  const id = path.slice(BUILT_IN_PREFIX.length);
  return BUILT_IN_WALLPAPERS.find((wallpaper) => wallpaper.id === id);
}

/** Absolute paths of every image directly in the folder, sorted by name. */
export async function listWallpapers(dir: string): Promise<string[]> {
  if (!dir) return [];
  try {
    const entries = await readDir(dir);
    return entries
      .filter((e) => !e.is_dir && IMAGE_EXT.test(e.name))
      .map((e) => e.path)
      // localeCompare with numeric so wall2 sorts before wall10, which plain
      // string order gets wrong and is exactly the case a numbered set hits.
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export function wallpaperName(path: string): string {
  return getBuiltInWallpaper(path)?.name ?? path.split(/[\\/]/).pop() ?? path;
}

/** Show this image, switching the wallpaper on if it was off. */
export function applyWallpaper(path: string): void {
  const bg = getPrefs().background;
  setPrefs({ background: { ...bg, path, enabled: true } });
}

/**
 * Move `step` images through the folder, wrapping at both ends.
 *
 * Returns the name applied, or null when there is nothing to move to — the
 * caller reports that, since silence would look like a broken keystroke.
 */
export async function stepWallpaper(step: number): Promise<string | null> {
  const bg = getPrefs().background;
  const list = await listWallpapers(bg.dir);
  if (list.length === 0) return null;

  const current = list.indexOf(bg.path);
  // Unset, or showing something outside the folder: step from the start rather
  // than refusing, so the first press always does something visible.
  const next = current === -1
    ? (step > 0 ? 0 : list.length - 1)
    : (current + step + list.length) % list.length;

  applyWallpaper(list[next]);
  return wallpaperName(list[next]);
}

/** A different image at random. Never returns the current one unless it is the only one. */
export async function randomWallpaper(): Promise<string | null> {
  const bg = getPrefs().background;
  const list = await listWallpapers(bg.dir);
  if (list.length === 0) return null;

  const others = list.filter((p) => p !== bg.path);
  const pool = others.length > 0 ? others : list;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  applyWallpaper(pick);
  return wallpaperName(pick);
}
