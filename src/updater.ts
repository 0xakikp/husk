import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "@/toast";

let checking = false;

export async function checkForUpdates(manual = false): Promise<void> {
  if (checking) return;
  checking = true;

  try {
    const update: Update | null = await check();
    if (!update) {
      if (manual) {
        toast({ title: "No updates available", variant: "info" });
      }
      return;
    }

    toast({
      title: `Update available: v${update.version}`,
      message: update.body ?? "A new version is available.",
      variant: "info",
    });

    // Download and install
    await update.downloadAndInstall((event: { event: string; data?: Record<string, unknown> }) => {
      switch (event.event) {
        case "Started":
          toast({ title: "Downloading update...", variant: "info" });
          break;
        case "Progress":
          // Optional: could show progress here
          break;
        case "Finished":
          toast({ title: "Download complete. Restarting...", variant: "info" });
          break;
      }
    });

    await relaunch();
  } catch (err) {
    console.error("Update check failed:", err);
    if (manual) {
      toast({
        title: "Update check failed",
        message: String(err),
        variant: "error",
      });
    }
  } finally {
    checking = false;
  }
}
