import { useEffect, useRef } from "react";
import { monaco, defineHuskTheme } from "./monacoEnv";
import { initVimMode } from "monaco-vim";
import { readFile, writeFile } from "../fs";
import { sshReadFile, sshWriteFile } from "../remote/remoteFs";
import { usePrefs, getPrefs, type Prefs } from "../settings/preferences";
import { fontStack } from "../styles/fonts";
import { registerEditorApplyEdit, registerEditorGetSelection, registerEditorFile } from "@/ai/editorStore";
import { markSaved, markModified, markNew, clearState } from "./dirtyStore";
import { EditorContextMenu } from "./EditorContextMenu";

/* ── External file change notifications ───────────────────────────── */

type FileChangeListener = (path: string) => void;
const fileChangeListeners = new Set<FileChangeListener>();

export function onFileChanged(path: string) {
  for (const fn of fileChangeListeners) {
    try { fn(path); } catch { /* ignore */ }
  }
}

export function watchFileChanges(fn: FileChangeListener): () => void {
  fileChangeListeners.add(fn);
  return () => fileChangeListeners.delete(fn);
}

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
    scrollbar: {
      vertical: "auto",
      horizontal: "auto",
      useShadows: false,
      verticalHasArrows: false,
      horizontalHasArrows: false,
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
    renderLineHighlight: p.editorLineHighlight,
  };
}

export type OpenFile = { path: string; name: string; remoteHost?: string | null };

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
  const filesRef = useRef(files);
  filesRef.current = files;
  const vimRef = useRef<{ dispose(): void } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const p = getPrefs();
    const editor = monaco.editor.create(hostRef.current, {
      theme: monacoTheme(p),
      automaticLayout: true,
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
      ...editorOptions(p),
    });
    editorRef.current = editor;

    // Force layout recalculation on container resize
    const resizeObserver = new ResizeObserver(() => {
      editor.layout();
    });
    if (hostRef.current) {
      resizeObserver.observe(hostRef.current);
    }

    // Cmd/Ctrl+S saves the active file.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = activePathRef.current;
      const model = editor.getModel();
      if (path && model) {
        const file = filesRef.current.find((f) => f.path === path);
        const host = file?.remoteHost;
        const save = host
          ? sshWriteFile(host, path, model.getValue())
          : writeFile(path, model.getValue());
        void save.then(() => {
          markSaved(path, model.getAlternativeVersionId());
        });
      }
    });

    // Track dirty state via Monaco model changes
    const dirtyDisposables: monaco.IDisposable[] = [];
    const trackModelDirty = (m: monaco.editor.ITextModel | null) => {
      if (!m) return;
      const path = m.uri.fsPath;
      const savedVersion = m.getAlternativeVersionId();
      markSaved(path, savedVersion);
      const d = m.onDidChangeContent(() => {
        const current = m.getAlternativeVersionId();
        if (current !== savedVersion) {
          markModified(path, current);
        }
      });
      dirtyDisposables.push(d);
    };

    // Track the initial model
    trackModelDirty(editor.getModel());

    // Track when model changes (user switches files)
    const dModelChange = editor.onDidChangeModel(() => {
      // Clean up old listeners
      dirtyDisposables.forEach((d) => d.dispose());
      dirtyDisposables.length = 0;
      trackModelDirty(editor.getModel());
    });
    dirtyDisposables.push(dModelChange);

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

    const unsubSel = registerEditorGetSelection(() => {
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model || sel.isEmpty()) return null;
      const text = model.getValueInRange(sel);
      return {
        text,
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
      };
    });

    const unsubFile = registerEditorFile(() => {
      return editor.getModel()?.uri.path ?? null;
    });

    // ── Editor context menu: Ask AI ───────────────────────────────────────
    editor.addAction({
      id: "husk-ask-ai",
      label: "Ask AI",
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 3,
      precondition: "editorHasSelection",
      run: (ed) => {
        const sel = ed.getSelection();
        const model = ed.getModel();
        if (!sel || !model || sel.isEmpty()) return;
        const text = model.getValueInRange(sel);
        const filePath = model.uri.path;
        // Open bubble and pre-fill with selection context
        import("../ai/bubbleStore").then(({ openBubble }) => {
          openBubble(`Explain this code from ${filePath} (lines ${sel.startLineNumber}-${sel.endLineNumber}):\n\n\`\`\`\n${text}\n\`\`\``);
        });
      },
    });

    return () => {
      resizeObserver.disconnect();
      unsub();
      unsubSel();
      unsubFile();
      dirtyDisposables.forEach((d) => d.dispose());
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



  // Watch for external file changes and reload the model
  useEffect(() => {
    const unsub = watchFileChanges((changedPath) => {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model || model.uri.fsPath !== changedPath) return;
      // File changed externally — reload from disk
      void readFile(changedPath).then((content) => {
        if (editorRef.current !== editor) return;
        const current = model.getValue();
        if (current === content) return;
        // Update model without adding to undo stack
        model.setValue(content);
        markSaved(changedPath, model.getAlternativeVersionId());
      });
    });
    return unsub;
  }, []);

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
        const file = files.find((f) => f.path === activePath);
        const host = file?.remoteHost;
        const content = host
          ? await sshReadFile(host, activePath).catch((e) => `// could not open file\n// ${e}`)
          : await readFile(activePath).catch((e) => `// could not open file\n// ${e}`);
        if (cancelled) return;
        model = monaco.editor.createModel(content, languageFor(activePath), uri);
        model.updateOptions({ tabSize: getPrefs().editorTabSize, insertSpaces: true });
        // Check if this file exists on disk; if not, mark as "new"
        const exists = content !== `// could not open file\n// Error: file not found`;
        if (!exists) {
          markNew(activePath);
        }
      }
      if (cancelled) return;
      // Ensure we're setting the model on the current editor instance
      if (editorRef.current === editor) {
        editor.setModel(model);
        // Delay layout to allow container to reach full height after visibility change
        setTimeout(() => {
          if (editorRef.current === editor && !cancelled) {
            const host = hostRef.current;
            if (host) {
              const rect = host.getBoundingClientRect();
              if (rect.height < 50) {
                // Container still too small, retry later
                setTimeout(() => {
                  if (editorRef.current === editor && !cancelled) {
                    editor.layout();
                    editor.focus();
                  }
                }, 200);
                return;
              }
            }
            editor.layout();
            editor.focus();
          }
        }, 100);
      }
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
        clearState(model.uri.fsPath);
        model.dispose();
      }
    }
  }, [files]);

  return (
    <div className="editor-area">
      <div style={{ paddingRight: 24, width: '100%', height: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
        <div className="editor-host" ref={hostRef} />
      </div>
      <div className="editor-vim-status" ref={statusRef} style={{ display: prefs.vimMode ? "block" : "none" }} />
      <EditorContextMenu editor={editorRef.current} />
    </div>
  );
}
