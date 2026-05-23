import { useEffect, useRef } from "react";
import { monaco } from "./monacoEnv";
import { readFile, writeFile } from "../fs";

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
  onSelect,
  onClose,
}: {
  files: OpenFile[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activePathRef = useRef<string | null>(activePath);

  useEffect(() => {
    if (!hostRef.current) return;
    const editor = monaco.editor.create(hostRef.current, {
      theme: "vs-dark",
      automaticLayout: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", Menlo, Monaco, monospace',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
    });
    editorRef.current = editor;

    // Cmd/Ctrl+S saves the active file.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const p = activePathRef.current;
      const model = editor.getModel();
      if (p && model) void writeFile(p, model.getValue());
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
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
        const content = await readFile(activePath).catch(
          (e) => `// could not open file\n// ${e}`,
        );
        if (cancelled) return;
        model = monaco.editor.createModel(content, languageFor(activePath), uri);
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
      <div className="editor-tabs">
        {files.map((f) => (
          <div key={f.path} className={`etab${f.path === activePath ? " active" : ""}`}>
            <button type="button" className="etab-label" onClick={() => onSelect(f.path)}>
              {f.name}
            </button>
            <button
              type="button"
              className="etab-close"
              aria-label={`Close ${f.name}`}
              onClick={() => onClose(f.path)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="editor-host" ref={hostRef} />
    </div>
  );
}
