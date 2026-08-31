import { toast } from "../toast";
import {
  notifyVaultChanged,
  openVaultNote,
  undoVaultCapture,
  type VaultCaptureResult,
} from "./aiCapture";

/** Shared, recoverable feedback for every surface that writes into Vault. */
export function showVaultCaptureToast(result: VaultCaptureResult, verb: "Saved" | "Added to"): void {
  notifyVaultChanged(result.path);
  toast({
    title: `${verb} ${result.name.replace(/\.(md|mdx|txt)$/i, "")}`,
    message: result.path,
    variant: "success",
    duration: 9000,
    actions: [
      { label: "Open", onClick: () => openVaultNote(result.path) },
      {
        label: "Undo",
        onClick: () => {
          void undoVaultCapture(result.undo)
            .then(() => {
              notifyVaultChanged(result.path);
              toast({ title: "Vault change undone", variant: "success", duration: 2200 });
            })
            .catch((error: unknown) => {
              toast({
                title: "Could not undo the Vault change",
                message: error instanceof Error ? error.message : String(error),
                variant: "warning",
                duration: 5500,
              });
            });
        },
      },
    ],
  });
}
