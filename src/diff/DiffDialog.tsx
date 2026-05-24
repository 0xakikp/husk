import { useEffect, useRef } from "react";
import { monaco } from "../editor/monacoEnv";
import { getPrefs } from "../settings/preferences";
import { fontStack } from "../styles/fonts";
import { readFile } from "../fs";

export function DiffDialog({
  onClose,
  initialLeft,
  initialRight,
}: {
  onClose: () => void;
  initialLeft?: string;
  initialRight?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const original = monaco.editor.createModel("", "plaintext");
    const modified = monaco.editor.createModel("", "plaintext");
    if (initialLeft) void readFile(initialLeft).then((t) => original.setValue(t)).catch(() => {});
    if (initialRight) void readFile(initialRight).then((t) => modified.setValue(t)).catch(() => {});
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      theme: getPrefs().theme === "dark" ? "vs-dark" : "vs",
      automaticLayout: true,
      originalEditable: true,
      renderSideBySide: true,
      fontSize: 13,
      fontFamily: fontStack(getPrefs().fontFamily),
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
