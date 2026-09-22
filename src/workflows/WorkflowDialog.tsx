import { CompactForm, CompactButton } from "../components/compact-form";
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PanelHeader } from "../shell/PanelHeader";
import { WorkflowCircle01Icon } from "@hugeicons/core-free-icons";
import "./workflowUi.css";

/** Deliberately portalled outside the sidebar sheet: editing needs room. */
export function WorkflowDialog({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  return <Dialog.Root open modal={false} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal><Dialog.Content className="compact-panel compact-dialog workflow-dialog" aria-describedby={undefined}
      onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
      <PanelHeader icon={WorkflowCircle01Icon} title={<Dialog.Title className="workflow-dialog-title">{title}</Dialog.Title>}
        actions={<Dialog.Close asChild><CompactButton type="button" variant="ghost" icon aria-label="Close workflow window" disabled={busy}>×</CompactButton></Dialog.Close>} />
      <CompactForm className="compact-body workflow-dialog-body">{children}</CompactForm>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
