import { useEffect, useRef } from "react";
import { monaco, defineHuskTheme } from "./monacoEnv";
import { initVimMode } from "monaco-vim";
import { readFile, writeFile } from "../fs";
import { usePrefs, getPrefs, type Prefs } from "../settings/preferences";
import { fontStack } from "../styles/fonts";
import { registerEditorApplyEdit } from "@/ai/editor/editorStore";

const monacoTheme = (p: Prefs) => {
  if (p.theme === "dark") {
    defineHuskTheme(p.editorWallpaperOpacity);
    return "husk-black";
  }
  return "vs";
};

/** Editor options driven by preferences (theme handled separately). */
function editorOptions(p: Prefs): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions {
  return {
    fontSize: p.editorFontSize,
    fontFamily: fontStack(p.fontFamily),
    fontLigatures: p.editorLigatures,
    minimap: { enabled: p.editorMinimap },
    wordWrap: p.editorWordWrap,
    lineNumbers: p.editorLineNumbers,
    cursorStyle: p.editorCursorStyle,
    cursorBlinking: p.editorCursorBlink ? "blink" : "solid",
    renderWhitespace: p.editorWhitespace,
    bracketPairColorization: { enabled: p.editorBracketColors },
    smoothScrolling: p.editorSmoothScroll,
    stickyScroll: { enabled: p.editorStickyScroll },
    formatOnPaste: p.editorFormatOnPaste,
    scrollBeyondLastLine: false,
    renderLineHighlight: p.editorLineHighlight,
  };
}

export type OpenFile = { path: string; name: string };

function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    json: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    md: "markdown",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    hpp: "cpp",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yml: "yaml",
    yaml: "yaml",
    toml: "ini",
    sql: "sql",
    xml: "xml",
  };
  return map[ext] ?? "plaintext";
}

export function EditorArea({
  files,
  activePath,
}: {
  files: OpenFile[];
  activePath: string | null;
}) {
  const prefs = usePrefs();
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activePathRef = useRef<string | null>(activePath);
  const vimRef = useRef<{ dispose(): void } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const p = getPrefs();
    const editor = monaco.editor.create(hostRef.current, {
      theme: monacoTheme(p),
      automaticLayout: true,
      ...editorOptions(p),
    });
    editorRef.current = editor;

    // Cmd/Ctrl+S saves the active file.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = activePathRef.current;
      const model = editor.getModel();
      if (path && model) void writeFile(path, model.getValue());
    });

    const unsub = registerEditorApplyEdit((search, replace) => {
      const model = editor.getModel();
      if (!model) return false;
      const text = model.getValue();
      const idx = text.indexOf(search);
      if (idx < 0) return false;
      const startPos = model.getPositionAt(idx);
      const endPos = model.getPositionAt(idx + search.length);
      model.pushEditOperations(
        [],
        [
          {
            range: new monaco.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
            text: replace,
          },
        ],
        () => null
      );
      return true;
    });

    return () => {
      unsub();
      vimRef.current?.dispose();
      vimRef.current = null;
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  // Apply preference changes (theme + all editor options + tab size).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    monaco.editor.setTheme(monacoTheme(prefs));
    editor.updateOptions(editorOptions(prefs));
    editor.getModel()?.updateOptions({ tabSize: prefs.editorTabSize, insertSpaces: true });
  }, [prefs]);

  // Toggle Vim keybindings.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (prefs.vimMode && !vimRef.current) {
      vimRef.current = initVimMode(editor, statusRef.current);
    } else if (!prefs.vimMode && vimRef.current) {
      vimRef.current.dispose();
      vimRef.current = null;
    }
  }, [prefs.vimMode]);

  // Load + show the active file (one model per path, reused if already open).
  useEffect(() => {
    activePathRef.current = activePath;
    const editor = editorRef.current;
    if (!editor || !activePath) return;
    let cancelled = false;
    void (async () => {
      const uri = monaco.Uri.file(activePath);
      let model = monaco.editor.getModel(uri);
      if (!model) {
        const content = await readFile(activePath).catch(
          (e) => `// could not open file\n// ${e}`,
        );
        if (cancelled) return;
        model = monaco.editor.createModel(content, languageFor(activePath), uri);
        model.updateOptions({ tabSize: getPrefs().editorTabSize, insertSpaces: true });
      }
      editor.setModel(model);
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  // Dispose models for files that are no longer open.
  useEffect(() => {
    const open = new Set(files.map((f) => f.path));
    for (const model of monaco.editor.getModels()) {
      if (model.uri.scheme === "file" && !open.has(model.uri.fsPath)) {
        model.dispose();
      }
    }
  }, [files]);

  return (
    <div className="editor-area">
      <div className="editor-host" ref={hostRef} />
      <div className="editor-vim-status" ref={statusRef} style={{ display: prefs.vimMode ? "block" : "none" }} />
    </div>
  );
}
