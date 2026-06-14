import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "@/toast";

let checking = false;
let pendingUpdate: Update | null = null;
const updaterState = { downloaded: 0 };

async function installUpdate(update: Update): Promise<void> {
  updaterState.downloaded = 0;
  try {
    await update.downloadAndInstall((event: { event: string; data?: Record<string, unknown> }) => {
      switch (event.event) {
        case "Started":
          toast({ title: "Downloading update…", variant: "info", duration: 3000 });
          break;
        case "Progress": {
          const chunk = event.data?.chunkLength as number | undefined;
          const total = event.data?.contentLength as number | undefined;
          if (chunk && total) {
            // Track cumulative downloaded bytes for accurate percentage
            updaterState.downloaded += chunk;
            const pct = Math.round((updaterState.downloaded / total) * 100);
            toast({ title: `Downloading… ${pct}%`, variant: "info", duration: 1500 });
          }
          break;
        }
        case "Finished":
          toast({ title: "Download complete. Restarting…", variant: "success", duration: 2000 });
          break;
      }
    });

    await relaunch();
  } catch (err) {
    console.error("Install failed:", err);
    toast({
      title: "Install failed",
      message: String(err),
      variant: "error",
      duration: 6000,
    });
  }
}

export async function checkForUpdates(manual = false): Promise<void> {
  if (checking) return;
  checking = true;

  try {
    if (manual) {
      toast({ title: "Checking for updates…", variant: "info", duration: 2000 });
    }

    const update: Update | null = await check();
    if (!update) {
      if (manual) {
        toast({ title: "You're on the latest version", variant: "success", duration: 3000 });
      }
      return;
    }

    pendingUpdate = update;

    toast({
      title: `Update available: v${update.version}`,
      message: update.body ?? "A new version is available.",
      variant: "info",
      duration: 0, // persistent until actioned
      action: {
        label: "Install & Restart",
        onClick: () => {
          if (pendingUpdate) {
            void installUpdate(pendingUpdate);
          }
        },
      },
    });
  } catch (err) {
    console.error("Update check failed:", err);
    if (manual) {
      toast({
        title: "Update check failed",
        message: String(err),
        variant: "error",
        duration: 5000,
      });
    }
  } finally {
    checking = false;
  }
}
