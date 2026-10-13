import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../components/ui/dropdown-menu";
import { useFileState } from "../editor/dirtyStore";
import type { NotesDockApi } from "./useNotesDock";
import "./NotesEditorChrome.css";

export function NotesEditorControls({ notes, path, fullTab, cramped, onMove, onClose }: {
  notes: NotesDockApi;
  path: string;
  fullTab?: boolean;
  cramped?: boolean;
  onMove: () => void;
  onClose?: () => void;
}) {
  const state = useFileState(path);
  const name = notes.files.find((file) => file.path === path)?.name ?? path.split("/").pop();
  return <div className="notes-editor-controls">
    <span className="notes-editor-title" title={path}>{name}</span>
    <span className="notes-editor-save-state" data-modified={state !== "clean"} title={state === "clean" ? "No unsaved changes" : "Save changes with Cmd+S / Ctrl+S"}>
      {state === "clean" ? "Saved" : state === "deleted" ? "Deleted on disk" : "Unsaved"}
    </span>
    {cramped && <span className="notes-editor-space-hint" title="The terminal splits need this height. Open the note in a full tab to keep working.">Use full tab</span>}
    <button type="button" className="notes-editor-action" onClick={onMove} aria-label={fullTab ? "Move note below terminal" : "Open note in full tab"} title={fullTab ? "Move note below terminal" : "Open note in full tab"}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        {fullTab ? <><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M3 9h10M6 11.5h4" /></> : <><path d="M9 2.5h4.5V7M13 3 7 9M6 2.5H3a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h10a.5.5 0 0 0 .5-.5v-3" /></>}
      </svg>
    </button>
    <DropdownMenu>
      <DropdownMenuTrigger asChild><button type="button" className="notes-editor-action" aria-label="Notes options" title="Notes options">⋯</button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="notes-opening-menu">
        <DropdownMenuLabel>Open notes by default</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={notes.preferredMode} onValueChange={(mode) => notes.setPreferredMode(mode === "tab" ? "tab" : "panel")}>
          <DropdownMenuRadioItem value="panel">Below terminal</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="tab">In a full tab</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {onClose && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={onClose}>Close note in panel</DropdownMenuItem></>}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

function NoteTab({ path, name, selected, onSelect, onClose }: { path: string; name: string; selected: boolean; onSelect: () => void; onClose: () => void }) {
  const state = useFileState(path);
  return <div className="notes-open-tab" data-selected={selected}>
    <button type="button" className="notes-open-tab__select" aria-pressed={selected} title={path} onClick={onSelect}>
      {state !== "clean" && <span className="notes-draft-dot" aria-label="Unsaved changes" />}
      <span>{name}</span>
    </button>
    <button type="button" className="notes-open-tab__close" aria-label={`Close ${name} in Notes panel`} title={`Close ${name}`} onClick={onClose}>×</button>
  </div>;
}

export function NotesOpenTabs({ notes, onSelect, onClose }: { notes: NotesDockApi; onSelect: (path: string, name: string) => void; onClose: (path: string) => void }) {
  if (notes.files.length < 2) return null;
  return <div className="notes-open-tabs" role="group" aria-label="Open notes">
    {notes.files.map((file) => <NoteTab key={file.path} path={file.path} name={file.name} selected={file.path === notes.activePath} onSelect={() => onSelect(file.path, file.name)} onClose={() => onClose(file.path)} />)}
  </div>;
}
