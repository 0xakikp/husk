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

import type { editor as MonacoEditor } from "monaco-editor";

interface EditorContextMenuProps {
  editor: MonacoEditor.IStandaloneCodeEditor | null;
}

export function EditorContextMenu({ editor }: EditorContextMenuProps) {
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    hasSelection: boolean;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      // Only show if right-clicking inside the editor host area
      const target = e.target as HTMLElement;
      if (!target.closest(".editor-host") && !target.closest(".monaco-editor")) return;

      e.preventDefault();
      const hasSelection = editor
        ? !editor.getSelection()?.isEmpty()
        : false;

      setMenu({ x: e.clientX, y: e.clientY, hasSelection });
    },
    [editor]
  );

  const handleClose = useCallback(() => {
    setMenu(null);
  }, []);

  useEffect(() => {
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("click", handleClose);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") handleClose();
    });

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("click", handleClose);
    };
  }, [handleContextMenu, handleClose]);

  if (!menu) return null;

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
    <div
      className="fixed z-[200] min-w-[180px] rounded-lg border border-border/60 bg-popover p-1 shadow-[0_8px_30px_rgba(0,0,0,0.4)]"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      {menu.hasSelection && (
        <>
          <button
            type="button"
            onClick={handleAskAI}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-foreground transition-colors",
              "hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <HugeiconsIcon icon={SparklesIcon} size={13} strokeWidth={1.5} />
            Ask AI
          </button>
          <div className="my-1 h-px bg-border/40" />
        </>
      )}

      <button
        type="button"
        onClick={handleCut}
        disabled={!menu.hasSelection}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
          menu.hasSelection
            ? "text-foreground hover:bg-accent hover:text-accent-foreground"
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
          "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
          menu.hasSelection
            ? "text-foreground hover:bg-accent hover:text-accent-foreground"
            : "text-muted-foreground/40 cursor-not-allowed"
        )}
      >
        <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.5} />
        Copy
      </button>

      <button
        type="button"
        onClick={handlePaste}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <HugeiconsIcon icon={ClipboardIcon} size={13} strokeWidth={1.5} />
        Paste
      </button>

      <div className="my-1 h-px bg-border/40" />

      <button
        type="button"
        onClick={handleSelectAll}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <HugeiconsIcon icon={SelectIcon} size={13} strokeWidth={1.5} />
        Select All
      </button>
    </div>
  );
}
