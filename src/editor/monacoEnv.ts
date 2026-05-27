import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

// Bundle Monaco's web workers locally (no CDN) so it works offline in Tauri.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

/**
 * Define the husk-black theme with configurable wallpaper opacity.
 * opacity = 0 means fully opaque black background (no wallpaper visible).
 * opacity = 30 means ~12% black overlay, so wallpaper shows through clearly.
 */
export function defineHuskTheme(wallpaperOpacity = 0): void {
  const alpha = Math.max(0, Math.min(255, Math.round((1 - wallpaperOpacity / 100) * 255)));
  const bg = `#000000${alpha.toString(16).padStart(2, "0")}`;
  monaco.editor.defineTheme("husk-black", {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": bg,
      "editorGutter.background": bg,
      "editorLineNumber.background": bg,
      "editorLineNumber.foreground": "#888888",
      "minimap.background": bg,
      "editorStickyScroll.background": bg,
      "editorStickyScrollHover.background": "#0a0a0a",
      "breadcrumb.background": bg,
      "editorWidget.background": "#0a0a0a",
      "editorWidget.border": "#1f1f1f",
      "editorSuggestWidget.background": "#0a0a0a",
      "editorHoverWidget.background": "#0a0a0a",
      "editorOverviewRuler.background": bg,
      "scrollbarSlider.background": "#1f1f1f80",
    },
  });
}

defineHuskTheme(0);

export { monaco };
