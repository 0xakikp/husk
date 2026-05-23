import { useState, type MouseEvent } from "react";
import { TerminalTabs } from "./TerminalTabs";
import { AiPanel } from "./ai/AiPanel";
import "./App.css";

function App() {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState(380);

  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = aiWidth;
    const onMove = (ev: globalThis.MouseEvent) => {
      const next = startW + (startX - ev.clientX);
      setAiWidth(Math.min(720, Math.max(280, next)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div className="app">
      <header className="titlebar">
        <img src="/logo.png" className="titlebar-logo" alt="huskv2" />
        <span className="titlebar-title">huskv2</span>
        <div className="titlebar-spacer" />
        <button
          type="button"
          className={`titlebar-ai${aiOpen ? " active" : ""}`}
          onClick={() => setAiOpen((v) => !v)}
          title="Toggle AI panel"
        >
          ✦ AI
        </button>
      </header>

      <div className="workspace">
        <div className="workspace-main">
          <TerminalTabs />
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
