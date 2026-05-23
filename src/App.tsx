import { useState, type MouseEvent } from "react";
import { TerminalTabs } from "./TerminalTabs";
import { AiPanel } from "./ai/AiPanel";
import { FileExplorer } from "./explorer/FileExplorer";
import { EditorArea, type OpenFile } from "./editor/EditorArea";
import "./App.css";

function App() {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState(380);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const openFile = (path: string, name: string) => {
    setOpenFiles((prev) => (prev.some((f) => f.path === path) ? prev : [...prev, { path, name }]));
    setActiveFile(path);
  };

  const closeFile = (path: string) => {
    const idx = openFiles.findIndex((f) => f.path === path);
    const next = openFiles.filter((f) => f.path !== path);
    setOpenFiles(next);
    if (activeFile === path) {
      setActiveFile(next.length ? next[Math.max(0, idx - 1)].path : null);
    }
  };

  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = aiWidth;
    const onMove = (ev: globalThis.MouseEvent) => {
      setAiWidth(Math.min(720, Math.max(280, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const hasEditor = openFiles.length > 0;

  return (
    <div className="app">
      <header className="titlebar">
        <img src="/logo.png" className="titlebar-logo" alt="huskv2" />
        <span className="titlebar-title">huskv2</span>
        <div className="titlebar-spacer" />
        <button
          type="button"
          className={`titlebar-btn${explorerOpen ? " active" : ""}`}
          onClick={() => setExplorerOpen((v) => !v)}
          title="Toggle explorer"
        >
          ☰ Files
        </button>
        <button
          type="button"
          className={`titlebar-btn${aiOpen ? " active" : ""}`}
          onClick={() => setAiOpen((v) => !v)}
          title="Toggle AI panel"
        >
          ✦ AI
        </button>
      </header>

      <div className="workspace">
        {explorerOpen ? (
          <div className="workspace-explorer">
            <FileExplorer onOpenFile={openFile} />
          </div>
        ) : null}

        <div className="workspace-main">
          {hasEditor ? (
            <div className="editor-region">
              <EditorArea
                files={openFiles}
                activePath={activeFile}
                onSelect={setActiveFile}
                onClose={closeFile}
              />
            </div>
          ) : null}
          <div className={`terminal-region${hasEditor ? " split" : ""}`}>
            <TerminalTabs />
          </div>
        </div>

        {aiOpen ? (
          <>
            <div
              className="resize-handle"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startResize}
            />
            <div className="workspace-ai" style={{ width: aiWidth }}>
              <AiPanel onClose={() => setAiOpen(false)} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export default App;
