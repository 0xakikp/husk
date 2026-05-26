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

// Pitch-black editor theme. vs-dark's background is #1e1e1e (grey); override
// every surface Monaco paints so the editor matches the app's all-black chrome.
monaco.editor.defineTheme("husk-black", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#000000",
    "editorGutter.background": "#000000",
    "editorLineNumber.background": "#000000",
    "minimap.background": "#000000",
    "editorStickyScroll.background": "#000000",
    "editorStickyScrollHover.background": "#0a0a0a",
    "breadcrumb.background": "#000000",
    "editorWidget.background": "#0a0a0a",
    "editorWidget.border": "#1f1f1f",
    "editorSuggestWidget.background": "#0a0a0a",
    "editorHoverWidget.background": "#0a0a0a",
    "editorOverviewRuler.background": "#000000",
    "scrollbarSlider.background": "#1f1f1f80",
  },
});

export { monaco };
