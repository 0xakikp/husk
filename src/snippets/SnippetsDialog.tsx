import { useEffect, useState } from "react";
import { loadSnippets, saveSnippets, newSnippetId, type Snippet } from "./store";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";

export function SnippetsDialog({ onClose }: { onClose: () => void }) {
  const [snippets, setSnippets] = useState<Snippet[]>(() => loadSnippets());
  const [editing, setEditing] = useState<Snippet | null>(null);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => saveSnippets(snippets), [snippets]);

  const startNew = () => {
    setEditing(null);
    setName("");
    setContent("");
    setFormOpen(true);
  };
  const startEdit = (s: Snippet) => {
    setEditing(s);
    setName(s.name);
    setContent(s.content);
    setFormOpen(true);
  };
  const save = () => {
    if (!name.trim() || !content.trim()) return;
    if (editing) {
      setSnippets((p) =>
        p.map((s) => (s.id === editing.id ? { ...s, name: name.trim(), content } : s)),
      );
    } else {
      setSnippets((p) => [...p, { id: newSnippetId(), name: name.trim(), content }]);
    }
    setFormOpen(false);
  };
  const insert = (s: Snippet) => {
    if (runInActiveTerminal(s.content)) {
      toast({ title: `Inserted: ${s.name}`, variant: "success" });
      onClose();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };
  const copy = (s: Snippet) => {
    void navigator.clipboard.writeText(s.content);
    toast({ title: "Copied to clipboard", variant: "info" });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Snippets" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Snippets</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {formOpen ? (
            <>
              <label className="rb-field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Restart API" />
              </label>
              <label className="rb-field">
                <span>Content</span>
                <textarea
                  className="snip-textarea"
                  value={content}
                  rows={4}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="kubectl rollout restart deployment/api"
                />
              </label>
              <div className="modal-actions">
                <button type="button" onClick={() => setFormOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="primary" onClick={save}>
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              {snippets.length === 0 ? (
                <p className="rb-empty">No snippets yet. Save commands you reuse and insert them into the terminal.</p>
              ) : (
                <div className="rb-list">
                  {snippets.map((s) => (
                    <div key={s.id} className="rb-item">
                      <button type="button" className="rb-run" title="Insert into terminal" onClick={() => insert(s)}>
                        ▶
                      </button>
                      <div className="rb-meta">
                        <span className="rb-name">{s.name}</span>
                        <span className="rb-steps">{s.content}</span>
                      </div>
                      <button type="button" className="ai-icon" title="Copy" onClick={() => copy(s)}>
                        ⧉
                      </button>
                      <button type="button" className="ai-icon" title="Edit" onClick={() => startEdit(s)}>
                        ✎
                      </button>
                      <button
                        type="button"
                        className="ai-icon"
                        title="Delete"
                        onClick={() => setSnippets((p) => p.filter((x) => x.id !== s.id))}
                      >
                        🗑
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="rb-new" onClick={startNew}>
                + New snippet
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
