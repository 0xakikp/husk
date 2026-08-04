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
  return path.split(/[\\/]/).pop() ?? path;
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
