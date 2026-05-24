import { useEffect, useRef } from "react";
import { monaco } from "../editor/monacoEnv";
import { getPrefs } from "../settings/preferences";

export function DiffDialog({ onClose }: { onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const original = monaco.editor.createModel("", "plaintext");
    const modified = monaco.editor.createModel("", "plaintext");
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      theme: getPrefs().theme === "dark" ? "vs-dark" : "vs",
      automaticLayout: true,
      originalEditable: true,
      renderSideBySide: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", Menlo, Monaco, monospace',
      minimap: { enabled: false },
    });
    editor.setModel({ original, modified });
    return () => {
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal diff-modal" role="dialog" aria-label="Diff" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Diff — paste into each side</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="diff-host" ref={hostRef} />
      </div>
    </div>
  );
}
