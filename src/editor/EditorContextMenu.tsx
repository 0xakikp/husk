import { useState, useCallback, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Copy01Icon,
  Scissor01Icon,
  ClipboardIcon,
  SelectIcon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import {
  huskContextMenuContentClass,
  huskContextMenuItemClass,
} from "../components/HuskContextMenu";

import type { editor as MonacoEditor } from "monaco-editor";
import { ScreenAiPopover, type ScreenAiSelection } from "../ai/ScreenAiPopover";
import { usePrefs } from "../settings/preferences";

let peekSequence = 0;

interface EditorContextMenuProps {
  editor: MonacoEditor.IStandaloneCodeEditor | null;
}

export function EditorContextMenu({ editor }: EditorContextMenuProps) {
  const prefs = usePrefs();
  const [peek, setPeek] = useState<ScreenAiSelection | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
    text: string;
    source: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      // Only show if right-clicking inside the editor host area
      const target = e.target as HTMLElement;
      if (!target.closest(".editor-host") && !target.closest(".monaco-editor")) return;
      if (!editor?.getDomNode()?.contains(target)) return;

      e.preventDefault();
      const hasSelection = editor
        ? !editor.getSelection()?.isEmpty()
        : false;

      const selection = editor.getSelection();
      const model = editor.getModel();
      setMenu({ x: e.clientX, y: e.clientY, hasSelection, text: selection && model ? model.getValueInRange(selection) : "", source: model ? `${model.uri.path} · L${selection?.startLineNumber ?? 1}` : "Editor selection" });
    },
    [editor]
  );

  const handleClose = useCallback(() => {
    setMenu(null);
  }, []);

  useEffect(() => {
    // The keydown listener used to be an inline arrow, so no reference survived
    // for removeEventListener and the cleanup silently omitted it — one listener
    // leaked per mount, forever.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", handleClose);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleClose);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [handleContextMenu, handleClose]);

  useEffect(() => { setPeek(null); }, [editor]);

  const handleCopy = () => {
    editor?.trigger("editor", "editor.action.clipboardCopyAction", null);
    handleClose();
  };

  const handleCut = () => {
    editor?.trigger("editor", "editor.action.clipboardCutAction", null);
    handleClose();
  };

  const handlePaste = () => {
    editor?.trigger("editor", "editor.action.clipboardPasteAction", null);
    handleClose();
  };

  const handleSelectAll = () => {
    editor?.trigger("editor", "editor.action.selectAll", null);
    handleClose();
  };

  const handleAskAI = () => {
    const sel = editor?.getSelection();
    const model = editor?.getModel();
    if (!sel || !model || sel.isEmpty()) {
      handleClose();
      return;
    }
    const text = model.getValueInRange(sel);
    const filePath = model.uri.path;
    import("../ai/bubbleStore").then(({ openBubble }) => {
      openBubble(
        `Explain this code from ${filePath} (lines ${sel.startLineNumber}-${sel.endLineNumber}):\n\n\`\`\`\n${text}\n\`\`\``
      );
    });
    handleClose();
  };

  return (
    <>
    {peek && <ScreenAiPopover key={peek.id} selection={peek} onClose={(restoreFocus = true) => { setPeek(null); if (restoreFocus) editor?.focus(); }} />}
    {menu &&
    <div
      className={cn(huskContextMenuContentClass, "fixed z-[200] min-w-[180px]")}
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {menu.hasSelection && (
        <>
          {prefs.aiEnabled && <button type="button" className={huskContextMenuItemClass} onClick={() => { setPeek({ id: ++peekSequence, kind: "peek", text: menu.text, source: menu.source, x: menu.x, y: menu.y }); handleClose(); }}><HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={1.5} />Explain here</button>}
          <button
            type="button"
            onClick={handleAskAI}
            className={cn(
              huskContextMenuItemClass,
            )}
          >
            <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={1.5} />
            Ask AI
          </button>
          <div className="husk-context-menu-separator" />
        </>
      )}

      <button
        type="button"
        onClick={handleCut}
        disabled={!menu.hasSelection}
        className={cn(
          huskContextMenuItemClass,
          menu.hasSelection
            ? ""
            : "text-muted-foreground/40 cursor-not-allowed"
        )}
      >
        <HugeiconsIcon icon={Scissor01Icon} size={13} strokeWidth={1.5} />
        Cut
      </button>

      <button
        type="button"
        onClick={handleCopy}
        disabled={!menu.hasSelection}
        className={cn(
          huskContextMenuItemClass,
          menu.hasSelection
            ? ""
            : "text-muted-foreground/40 cursor-not-allowed"
        )}
      >
        <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.5} />
        Copy
      </button>

      <button
        type="button"
        onClick={handlePaste}
        className={huskContextMenuItemClass}
      >
        <HugeiconsIcon icon={ClipboardIcon} size={13} strokeWidth={1.5} />
        Paste
      </button>

      <div className="husk-context-menu-separator" />

      <button
        type="button"
        onClick={handleSelectAll}
        className={huskContextMenuItemClass}
      >
        <HugeiconsIcon icon={SelectIcon} size={13} strokeWidth={1.5} />
        Select All
      </button>
    </div>
    }
    </>
  );
}
