import { afterEach, describe, expect, it } from "vitest";
import { getPrefs, setPrefs } from "./preferences";
import {
  BUILT_IN_WALLPAPERS,
  applyWallpaper,
  builtInWallpaperPath,
  getBuiltInWallpaper,
} from "./wallpapers";

const originalBackground = { ...getPrefs().background };

afterEach(() => {
  setPrefs({ background: { ...originalBackground } });
});

describe("built-in wallpapers", () => {
  it("round-trips every bundled wallpaper identifier", () => {
    for (const wallpaper of BUILT_IN_WALLPAPERS) {
      expect(getBuiltInWallpaper(builtInWallpaperPath(wallpaper.id))).toBe(wallpaper);
    }
  });

  it("selects the wallpaper and enables rendering without losing other settings", () => {
    setPrefs({
      background: {
        ...originalBackground,
        enabled: false,
        path: "",
        opacity: 35,
        blur: 14,
        fit: "contain",
      },
    });

    const path = builtInWallpaperPath(BUILT_IN_WALLPAPERS[0].id);
    applyWallpaper(path);

    expect(getPrefs().background).toEqual({
      ...originalBackground,
      enabled: true,
      path,
      opacity: 35,
      blur: 14,
      fit: "contain",
    });
  });
});
