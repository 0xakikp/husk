import { CompactForm, CompactButton } from "../components/compact-form";
import { useLayoutEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PanelHeader } from "../shell/PanelHeader";
import { WorkflowCircle01Icon } from "@hugeicons/core-free-icons";
import "./workflowUi.css";

/** Portalled outside the sidebar sheet. Run previews have a smaller footprint;
 * imports/capture keep their wider comparison space. */
export function WorkflowDialog({ title, onClose, children, busy = false, variant = "default", footer }: {
  title: string; onClose: () => void; children: ReactNode; busy?: boolean;
  variant?: "default" | "run"; footer?: ReactNode;
}) {
  const [runHost, setRunHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setRunHost(variant === "run" ? document.querySelector<HTMLElement>("[data-workflow-run-host]") : null);
  }, [variant]);
  // Portalling into the workspace makes CSS centering track sidebar resizing,
  // hiding, and window size changes without reading screen coordinates.
  const content = <Dialog.Content className={"compact-panel compact-dialog workflow-dialog" + (variant === "run" ? " workflow-run-dialog" : "")} aria-describedby={undefined}
    onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => { if (busy) event.preventDefault(); }}>
    <PanelHeader icon={WorkflowCircle01Icon} title={<Dialog.Title className="workflow-dialog-title">{title}</Dialog.Title>}
      actions={<Dialog.Close asChild><CompactButton type="button" variant="ghost" icon aria-label="Close workflow window" disabled={busy}>×</CompactButton></Dialog.Close>} />
    <CompactForm className="compact-body workflow-dialog-body" tabIndex={variant === "run" ? 0 : undefined}
      role={variant === "run" ? "region" : undefined} aria-label={variant === "run" ? "Workflow review content" : undefined}>{children}</CompactForm>
    {footer && <div className="workflow-dialog-footer">{footer}</div>}
  </Dialog.Content>;
  return <Dialog.Root open modal={false} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal container={variant === "run" ? runHost : undefined}>
      {variant === "run" ? <div className="workflow-run-layer" data-workspace={!!runHost}>{content}</div> : content}
    </Dialog.Portal>
  </Dialog.Root>;
}
