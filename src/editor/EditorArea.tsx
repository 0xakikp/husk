import { useCallback, useEffect, useRef } from "react";
import { monaco, defineHuskTheme } from "./monacoEnv";
import { initVimMode } from "monaco-vim";
import { readFile, writeFile } from "../fs";
import { recordTimelineEvent } from "../timeline/store";
import { sshReadFile, sshWriteFile } from "../remote/remoteFs";
import { usePrefs, getPrefs, type Prefs } from "../settings/preferences";
import { fontStack } from "../styles/fonts";
import {
  registerEditorApplyEdit,
  registerEditorGetSelection,
  registerEditorFile,
  registerEditorCloseFind,
  registerEditorDocument,
} from "@/ai/editorStore";
import { markSaved, markModified, markNew, clearState, getFileState } from "./dirtyStore";
import { EditorContextMenu } from "./EditorContextMenu";
import { toast } from "../toast";

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
  return "husk-light";
};

/** Editor options driven by preferences (theme handled separately). */
function editorOptions(p: Prefs): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions {
  return {
    fontSize: p.editorFontSize,
    fontFamily: fontStack(p.fontFamily),
    fontLigatures: p.editorLigatures,
    minimap: { enabled: p.editorMinimap },
    // Was hardcoded "on", so the wordWrap setting never reached Monaco.
    wordWrap: p.editorWordWrap,
    wrappingStrategy: "advanced",
    scrollBeyondLastColumn: 0,
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
      horizontal: "hidden",
      useShadows: false,
      verticalHasArrows: false,
      horizontalHasArrows: false,
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
    renderLineHighlight: p.editorLineHighlight,
  };
}

export type OpenFile = { path: string; name: string; remoteHost?: string | null; pinned?: boolean };
export type EditorRevealTarget = { path: string; line: number; requestId: number | string };

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
  visible = true,
  placementKey,
  revealTarget,
}: {
  files: OpenFile[];
  activePath: string | null;
  visible?: boolean;
  /** Explicit view moves can blur Monaco even when the same model stays visible. */
  placementKey?: string | number;
  revealTarget?: EditorRevealTarget | null;
}) {
  const prefs = usePrefs();
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activePathRef = useRef<string | null>(activePath);
  activePathRef.current = activePath;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const filesRef = useRef(files);
  filesRef.current = files;
  const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState>());
  const trackedModelsRef = useRef(new Map<monaco.editor.ITextModel, monaco.IDisposable>());
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vimRef = useRef<{ dispose(): void } | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  /* Pending "reveal line N of file X" request, e.g. from a launcher grep hit.
     Held until the model for that path is the active one, since the request
     arrives before the file has finished loading. */
  const pendingRevealRef = useRef<{ path: string; line: number } | null>(null);

  const applyPendingReveal = useCallback(() => {
    const target = pendingRevealRef.current;
    const editor = editorRef.current;
    if (!target || !editor || !visibleRef.current) return;
    if (activePathRef.current !== target.path) return;
    const model = editor.getModel();
    if (!model || model.uri.path !== monaco.Uri.file(target.path).path) return;
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect || rect.height < 50 || rect.width <= 0) return;
    pendingRevealRef.current = null;
    const line = Math.max(1, Math.min(target.line, model.getLineCount()));
    editor.revealLineInCenter(line);
    editor.setPosition({ lineNumber: line, column: 1 });
    editor.focus();
  }, []);

  const trackModel = useCallback((model: monaco.editor.ITextModel) => {
    if (trackedModelsRef.current.has(model)) return;
    const path = model.uri.fsPath;
    if (getFileState(path) === "clean") markSaved(path, model.getAlternativeVersionId());
    trackedModelsRef.current.set(model, model.onDidChangeContent(() => {
      markModified(path, model.getAlternativeVersionId());
    }));
  }, []);

  const scheduleFocus = useCallback(() => {
    if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !visibleRef.current) return;
    const focus = (retry: boolean) => {
      focusTimerRef.current = null;
      if (!visibleRef.current || editorRef.current !== editor || editor.getModel() !== model
        || activePathRef.current !== model.uri.fsPath || model.isDisposed()) return;
      const rect = hostRef.current?.getBoundingClientRect();
      if (!rect || rect.height < 50 || rect.width <= 0) {
        if (retry) focusTimerRef.current = setTimeout(() => focus(false), 200);
        return;
      }
      editor.layout({ width: rect.width, height: rect.height });
      applyPendingReveal();
      editor.focus();
    };
    focusTimerRef.current = setTimeout(() => focus(true), 100);
  }, [applyPendingReveal]);

  useEffect(() => {
    const onReveal = (e: Event) => {
      const detail = (e as CustomEvent<{ path?: string; line?: number }>).detail;
      if (!detail?.path || !detail.line) return;
      pendingRevealRef.current = { path: detail.path, line: detail.line };
      applyPendingReveal();
    };
    window.addEventListener("husk:reveal-line", onReveal);
    return () => window.removeEventListener("husk:reveal-line", onReveal);
  }, [applyPendingReveal]);

  useEffect(() => {
    if (!revealTarget) return;
    pendingRevealRef.current = { path: revealTarget.path, line: revealTarget.line };
    applyPendingReveal();
  }, [revealTarget?.path, revealTarget?.line, revealTarget?.requestId, applyPendingReveal]);

  useEffect(() => {
    if (!hostRef.current) return;
    const p = getPrefs();
    const editor = monaco.editor.create(hostRef.current, {
      ...editorOptions(p),
      theme: monacoTheme(p),
      // Explicit observation lets a collapsed dock remain completely dormant.
      automaticLayout: false,
      fixedOverflowWidgets: true,
      padding: { top: 8, bottom: 8 },
    });
    editorRef.current = editor;

    // Force layout recalculation on container or window resize
    const relayout = () => { if (visibleRef.current) editor.layout(); };
    const resizeObserver = new ResizeObserver(relayout);
    resizeObserver.observe(hostRef.current);
    window.addEventListener("resize", relayout);

    // Cmd/Ctrl+S saves the active file.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = activePathRef.current;
      const model = editor.getModel();
      if (visibleRef.current && path && model && model.uri.fsPath === path) {
        const file = filesRef.current.find((f) => f.path === path);
        if (!file) return;
        const host = file.remoteHost;
        const savedVersion = model.getAlternativeVersionId();
        const save = host
          ? sshWriteFile(host, path, model.getValue())
          : writeFile(path, model.getValue());
        void save.then(() => {
          if (model.isDisposed() || monaco.editor.getModel(model.uri) !== model) return;
          markSaved(path, savedVersion, model.getAlternativeVersionId());
          /* Timeline records the save event — path only, never contents. */
          recordTimelineEvent("file", `Edited ${path.split("/").pop() || path}`, { path });
        }).catch((error) => {
          toast({ title: "Failed to save file", message: String(error), variant: "error" });
        });
      }
    });

    const unsub = registerEditorApplyEdit((search, replace) => {
      const model = editor.getModel();
      if (!visibleRef.current || !model || model.uri.fsPath !== activePathRef.current) return false;
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
      if (!visibleRef.current) return null;
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model || model.uri.fsPath !== activePathRef.current || sel.isEmpty()) return null;
      const text = model.getValueInRange(sel);
      return {
        text,
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
      };
    });

    const unsubFile = registerEditorFile(() => {
      const model = editor.getModel();
      return visibleRef.current && model?.uri.fsPath === activePathRef.current ? model.uri.path : null;
    });

    const unsubDocument = registerEditorDocument(
      (requestedPath) => {
        if (!requestedPath && !visibleRef.current) return null;
        const model = requestedPath
          ? monaco.editor.getModel(monaco.Uri.file(requestedPath))
          : editor.getModel();
        if (!requestedPath && model?.uri.fsPath !== activePathRef.current) return null;
        return model ? { path: model.uri.fsPath, text: model.getValue() } : null;
      },
      async (path, expected, replacement) => {
        const model = monaco.editor.getModel(monaco.Uri.file(path));
        if (!model || model.uri.fsPath !== path || model.getValue() !== expected) return false;
        const file = filesRef.current.find((candidate) => candidate.path === path);
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: replacement }],
          () => null,
        );
        const appliedVersion = model.getAlternativeVersionId();
        const save = file?.remoteHost
          ? sshWriteFile(file.remoteHost, path, replacement)
          : writeFile(path, replacement);
        try {
          await save;
        } catch (error) {
          /* If persistence fails and the user has not typed meanwhile, return
             the model to the exact text they reviewed rather than leaving a
             proposal that the UI reported as unapplied. */
          if (!model.isDisposed() && monaco.editor.getModel(model.uri) === model
            && model.getAlternativeVersionId() === appliedVersion && model.getValue() === replacement) {
            model.pushEditOperations(
              [],
              [{ range: model.getFullModelRange(), text: expected }],
              () => null,
            );
          }
          throw error;
        }
        if (!model.isDisposed() && monaco.editor.getModel(model.uri) === model) {
          markSaved(path, appliedVersion, model.getAlternativeVersionId());
        }
        recordTimelineEvent("file", `Organized ${path.split("/").pop() || path}`, { path });
        return true;
      },
    );

    const unsubCloseFind = registerEditorCloseFind(() => {
      const findController = editor.getContribution("editor.contrib.findController") as
        | { closeFindWidget(): void }
        | null;
      findController?.closeFindWidget();
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
      window.removeEventListener("resize", relayout);
      unsub();
      unsubSel();
      unsubFile();
      unsubDocument();
      unsubCloseFind();
      if (focusTimerRef.current !== null) clearTimeout(focusTimerRef.current);
      for (const disposable of trackedModelsRef.current.values()) disposable.dispose();
      trackedModelsRef.current.clear();
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
  // Only clean local models may absorb external writes. Check again after the
  // read: the user can type, close, delete, or replace the model while it runs.
  useEffect(() => {
    const requests = new Map<string, number>();
    const unsub = watchFileChanges((changedPath) => {
      const editor = editorRef.current;
      if (!editor) return;
      const file = filesRef.current.find((candidate) => candidate.path === changedPath);
      if (!file || file.remoteHost || getFileState(changedPath) !== "clean") return;
      const model = monaco.editor.getModel(monaco.Uri.file(changedPath));
      if (!model || !trackedModelsRef.current.has(model)) return;
      const version = model.getVersionId();
      const request = (requests.get(changedPath) ?? 0) + 1;
      requests.set(changedPath, request);
      void readFile(changedPath).then((content) => {
        const currentFile = filesRef.current.find((candidate) => candidate.path === changedPath);
        if (editorRef.current !== editor || requests.get(changedPath) !== request
          || !currentFile || currentFile.remoteHost || model.isDisposed()
          || monaco.editor.getModel(model.uri) !== model
          || getFileState(changedPath) !== "clean" || model.getVersionId() !== version) return;
        const current = model.getValue();
        if (current === content) return;
        /* pushEditOperations, not setValue. The old comment claimed setValue
           avoided the undo stack; it clears it outright, so an external write to
           the open file silently destroyed every undo step you had. Replacing the
           full range as an edit operation keeps the history and makes the reload
           itself undoable. */
        model.pushEditOperations(
          [],
          [{ range: model.getFullModelRange(), text: content }],
          () => null,
        );
        markSaved(changedPath, model.getAlternativeVersionId());
      }).catch(() => { /* A renamed/deleted file may no longer be readable. */ });
    });
    return unsub;
  }, []);

  // Load + show the active file (one model per path, reused if already open).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const previous = editor.getModel();
    if (previous && previous.uri.fsPath !== activePath) {
      const state = editor.saveViewState();
      if (state) viewStatesRef.current.set(previous.uri.fsPath, state);
      editor.setModel(null);
    }
    if (!activePath) return;
    let cancelled = false;
    void (async () => {
      const uri = monaco.Uri.file(activePath);
      let model = monaco.editor.getModel(uri);
      if (!model) {
        const file = filesRef.current.find((f) => f.path === activePath);
        if (!file) return;
        const host = file?.remoteHost;
        const content = host
          ? await sshReadFile(host, activePath).catch((e) => `// could not open file\n// ${e}`)
          : await readFile(activePath).catch((e) => `// could not open file\n// ${e}`);
        if (cancelled || editorRef.current !== editor
          || !filesRef.current.some((candidate) => candidate.path === activePath)) return;
        // Another explicit document operation may have created it during I/O.
        model = monaco.editor.getModel(uri) ?? monaco.editor.createModel(content, languageFor(activePath), uri);
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
        trackModel(model);
        editor.setModel(model);
        const state = viewStatesRef.current.get(activePath);
        if (state) editor.restoreViewState(state);
        applyPendingReveal();
        scheduleFocus();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activePath, applyPendingReveal, scheduleFocus, trackModel]);

  // Moving the persistent editor between hosts does not switch models, but DOM
  // reparenting can blur it. Explicit placement changes need a guarded focus
  // pass just like opening the drawer; collapsing cancels old timers.
  useEffect(() => {
    if (visible) {
      applyPendingReveal();
      scheduleFocus();
    } else if (focusTimerRef.current !== null) {
      clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    }
  }, [visible, placementKey, applyPendingReveal, scheduleFocus]);

  // Dispose models for files that are no longer open.
  useEffect(() => {
    const open = new Set(files.map((f) => f.path));
    for (const model of monaco.editor.getModels()) {
      if (model.uri.scheme === "file" && !open.has(model.uri.fsPath)) {
        if (editorRef.current?.getModel() === model) editorRef.current.setModel(null);
        trackedModelsRef.current.get(model)?.dispose();
        trackedModelsRef.current.delete(model);
        viewStatesRef.current.delete(model.uri.fsPath);
        clearState(model.uri.fsPath);
        model.dispose();
      }
    }
  }, [files]);

  return (
    <div className="editor-area">
      <div className="editor-host" ref={hostRef} />
      <div className="editor-vim-status" ref={statusRef} style={{ display: prefs.vimMode ? "block" : "none" }} />
      <EditorContextMenu editor={editorRef.current} />
    </div>
  );
}
