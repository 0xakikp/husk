import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  CommandIcon,
  Copy01Icon,
  NotebookIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "../toast";
import {
  appendAiNote,
  createAiNote,
  extractCommandMarkdown,
  listVaultNoteTargets,
  markdownToPlainText,
  type AiCaptureMetadata,
  type VaultNoteTarget,
} from "./aiCapture";
import { showVaultCaptureToast } from "./captureToast";
import "./AiNoteCaptureMenu.css";

export type AiNoteCaptureTarget = {
  x: number;
  y: number;
  content: string;
  selectedText?: string;
  workspacePath?: string;
  conversationName?: string;
  source?: AiCaptureMetadata["source"];
  captureTitle?: string;
};

export function AiNoteCaptureMenu({
  target,
  onClose,
  onRedo,
  initialView = "actions",
}: {
  target: AiNoteCaptureTarget;
  onClose: () => void;
  onRedo?: () => void;
  initialView?: "actions" | "append";
}) {
  const [view, setView] = useState<"actions" | "append">(initialView);
  const [notes, setNotes] = useState<VaultNoteTarget[]>([]);
  const [query, setQuery] = useState("");
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = target.selectedText?.trim() || "";
  const commands = extractCommandMarkdown(target.content);
  const appendContent = selected || target.content;

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const closeOnViewportChange = () => onClose();
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [onClose]);

  useEffect(() => {
    if (initialView !== "append") return;
    setLoadingNotes(true);
    void listVaultNoteTargets()
      .then(setNotes)
      .catch((error) => {
        toast({
          title: "Could not load Vault notes",
          message: error instanceof Error ? error.message : String(error),
          variant: "error",
        });
        onClose();
      })
      .finally(() => setLoadingNotes(false));
  }, [initialView, onClose]);

  const metadata = (kind: AiCaptureMetadata["kind"]): AiCaptureMetadata => ({
    kind,
    workspacePath: target.workspacePath,
    conversationName: target.conversationName,
    source: target.source,
    title: target.captureTitle,
  });

  const copy = async (content: string, label: string) => {
    try {
      await writeText(content);
      toast({ title: label, variant: "success", duration: 1500 });
      onClose();
    } catch (error) {
      toast({
        title: "Could not copy the response",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
    }
  };

  const saveNew = async (content: string, kind: AiCaptureMetadata["kind"]) => {
    if (saving) return;
    setSaving(true);
    try {
      const result = await createAiNote(content, metadata(kind));
      showVaultCaptureToast(result, "Saved");
      onClose();
    } catch (error) {
      toast({
        title: "Could not save to Vault",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
      setSaving(false);
    }
  };

  const openAppendPicker = async () => {
    setView("append");
    setLoadingNotes(true);
    try {
      setNotes(await listVaultNoteTargets());
    } catch (error) {
      toast({
        title: "Could not load Vault notes",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
      setView("actions");
    } finally {
      setLoadingNotes(false);
    }
  };

  const appendTo = async (note: VaultNoteTarget) => {
    if (saving) return;
    setSaving(true);
    try {
      const kind: AiCaptureMetadata["kind"] = selected ? "selection" : "response";
      const result = await appendAiNote(note.path, appendContent, metadata(kind));
      showVaultCaptureToast(result, "Added to");
      onClose();
    } catch (error) {
      toast({
        title: "Could not update the note",
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
      setSaving(false);
    }
  };

  const filteredNotes = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return notes;
    return notes.filter((note) => `${note.name} ${note.folder}`.toLocaleLowerCase().includes(needle));
  }, [notes, query]);

  const menuWidth = view === "append" ? 286 : 224;
  const menuHeight = view === "append" ? 330 : selected && commands ? 260 : 230;
  const left = Math.max(8, Math.min(target.x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(target.y, window.innerHeight - menuHeight - 8));

  return createPortal(
    <div className="ai-note-menu-layer" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div
        className="ai-note-menu"
        style={{ left, top, width: menuWidth }}
        role={view === "append" ? "dialog" : "menu"}
        aria-label={view === "append" ? "Append capture to a Vault note" : "Capture actions"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {view === "actions" ? (
          <>
            <div className="ai-note-menu-label">{target.source === "husk-terminal" ? "TERMINAL" : "RESPONSE"}</div>
            <button type="button" role="menuitem" onClick={() => void copy(markdownToPlainText(target.content), "Response copied")}>
              <HugeiconsIcon icon={Copy01Icon} size={12} />
              <span>Copy</span>
            </button>
            <button type="button" role="menuitem" onClick={() => void copy(target.content, "Markdown copied")}>
              <HugeiconsIcon icon={Copy01Icon} size={12} />
              <span>Copy as Markdown</span>
            </button>
            <div className="ai-note-menu-separator" />
            {selected && (
              <button type="button" role="menuitem" disabled={saving} onClick={() => void saveNew(selected, "selection")}>
                <HugeiconsIcon icon={NotebookIcon} size={12} />
                <span>Save selection to Vault</span>
              </button>
            )}
            <button type="button" role="menuitem" disabled={saving} onClick={() => void saveNew(target.content, "response")}>
              <HugeiconsIcon icon={NotebookIcon} size={12} />
              <span>Save {selected ? "response" : "to Vault"}</span>
            </button>
            <button type="button" role="menuitem" disabled={saving} onClick={() => void openAppendPicker()}>
              <HugeiconsIcon icon={NotebookIcon} size={12} />
              <span>Append {selected ? "selection" : "to existing note"}…</span>
            </button>
            {commands && (
              <button type="button" role="menuitem" disabled={saving} onClick={() => void saveNew(commands, "commands")}>
                <HugeiconsIcon icon={CommandIcon} size={12} />
                <span>Save commands only</span>
              </button>
            )}
            {onRedo && (
              <>
                <div className="ai-note-menu-separator" />
                <button type="button" role="menuitem" onClick={() => { onRedo(); onClose(); }}>
                  <HugeiconsIcon icon={Refresh01Icon} size={12} />
                  <span>Redo response</span>
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <div className="ai-note-picker-head">
              <button type="button" onClick={() => setView("actions")} aria-label="Back to response actions">
                <HugeiconsIcon icon={ArrowLeft01Icon} size={12} />
              </button>
              <span>APPEND TO NOTE</span>
            </div>
            <label className="ai-note-picker-search">
              <HugeiconsIcon icon={Search01Icon} size={11} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Vault…"
              />
            </label>
            <div className="ai-note-picker-list">
              {loadingNotes ? (
                <div className="ai-note-picker-empty">Loading notes…</div>
              ) : filteredNotes.length ? (
                filteredNotes.slice(0, 40).map((note) => (
                  <button key={note.path} type="button" disabled={saving} onClick={() => void appendTo(note)} title={note.path}>
                    <HugeiconsIcon icon={NotebookIcon} size={12} />
                    <span>
                      <strong>{note.name.replace(/\.(md|mdx|txt)$/i, "")}</strong>
                      <small>{note.folder}</small>
                    </span>
                  </button>
                ))
              ) : (
                <div className="ai-note-picker-empty">{notes.length ? "No matching notes" : "No notes in Vault yet"}</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
