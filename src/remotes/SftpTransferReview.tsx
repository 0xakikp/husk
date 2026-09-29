import { useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CompactButton, CompactForm } from "../components/compact-form";
import type { SftpTransfer } from "../remote/sftpTransfers";

export type SftpTransferDraft = Pick<SftpTransfer, "direction" | "kind" | "localPath" | "remotePath" | "label">;
export function SftpTransferReview({ target, drafts, onConfirm, onCancel }: {
  target: string; drafts: SftpTransferDraft[];
  onConfirm: (allowOverwrite: boolean) => void; onCancel: () => void;
}) {
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  const upload = drafts[0]?.direction === "upload";
  return <Dialog.Root open onOpenChange={open => { if (!open) onCancel(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-background/80" />
    <Dialog.Content aria-label="Review SFTP transfer" aria-describedby={undefined} onOpenAutoFocus={event => { event.preventDefault(); cancel.current?.focus(); }} onPointerDownOutside={event => event.preventDefault()} className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-lg border border-border bg-popover p-4 text-foreground">
      <CompactForm>
        <Dialog.Title className="text-sm font-semibold">Review {upload ? "upload" : "download"}</Dialog.Title>
        <p className="break-all text-xs">Remote: {target}</p>
        <ul className="space-y-3 text-xs">{drafts.map((draft, index) => <li key={index} className="break-all border-b border-border pb-2">
          <strong>{draft.label}{draft.kind === "folder" ? " (folder and contents)" : ""}</strong>
          <p>From: {upload ? draft.localPath : draft.remotePath}</p>
          <p>To: {upload ? draft.remotePath : draft.localPath}{draft.kind === "folder" ? ` / ${draft.label}` : ""}</p>
        </li>)}</ul>
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={allowOverwrite} onChange={event => setAllowOverwrite(event.target.checked)} />Allow replacing existing files at these destinations</label>
        <p className="compact-hint">{allowOverwrite ? "Existing matching files may be permanently replaced. Folder transfers merge contents; file/folder type conflicts are refused." : "Existing files are protected. A conflict stops the affected transfer instead of overwriting it."} Transfers are not atomic; a stopped folder transfer can leave files already copied.</p>
        <div className="compact-actions">
          <CompactButton ref={cancel} onClick={onCancel}>Cancel</CompactButton>
          <CompactButton variant={allowOverwrite ? "danger" : "primary"} onClick={() => onConfirm(allowOverwrite)}>{allowOverwrite ? "Confirm transfer & replacements" : upload ? "Upload" : "Download"}</CompactButton>
        </div>
      </CompactForm>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
