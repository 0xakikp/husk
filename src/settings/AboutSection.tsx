import { useEffect, useState } from "react";
import {
  GithubIcon,
  Tag01Icon,
  CpuIcon,
  LicenseIcon,
  DownloadCircle01Icon,
  Coffee01Icon,
  Idea01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdates } from "../updater";
import { SectionHeader } from "./components/SectionHeader";

const REPO_URL = "https://github.com/0xakikp/husk";
const FEEDBACK_URL = "https://github.com/0xakikp/husk/issues/new";
const BUY_ME_A_COFFEE_URL = "https://buymeacoffee.com/akikp";

function platformLabel(): string {
  const ua = navigator.userAgent;
  if (ua.includes("Mac")) return "macOS";
  if (ua.includes("Win")) return "Windows";
  if (ua.includes("Linux")) return "Linux";
  return "desktop";
}

function MetaPill({
  icon,
  label,
  value,
}: {
  icon: typeof Tag01Icon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/40 px-3 py-2.5">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
        <HugeiconsIcon
          icon={icon}
          size={14}
          strokeWidth={1.5}
          className="text-primary"
        />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="truncate font-mono text-[11.5px] text-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}

export function AboutSection() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0"));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Manifest" />

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border/40 bg-card/30 px-6 py-8 text-center">
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-primary/10 blur-2xl" />
          <img src="/logo.png" alt="" className="relative size-16 rounded-xl" draggable={false} />
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[18px] font-semibold tracking-tight">Husk</span>
            <span className="rounded-full border border-border/40 bg-card px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
              v{version || "—"}
            </span>
          </div>
          <span className="text-[12px] text-muted-foreground">Intelligence, stripped to the shell.</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MetaPill icon={CpuIcon} label="Build" value={platformLabel()} />
        <MetaPill icon={Tag01Icon} label="Maker" value="@akikp" />
        <MetaPill icon={LicenseIcon} label="License" value="Apache 2.0" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-5">
        {[
          { icon: DownloadCircle01Icon, label: "Check for updates", action: () => void checkForUpdates(true) as void },
          { icon: GithubIcon, label: "GitHub", url: REPO_URL },
          { icon: Idea01Icon, label: "Feedback", url: FEEDBACK_URL },
          { icon: Coffee01Icon, label: "Support", url: BUY_ME_A_COFFEE_URL },
        ].map((a) => (
          <button type="button"
            key={a.label}
            onClick={() => void ("action" in a && typeof a.action === "function" ? a.action() : openUrl(a.url))}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={a.icon} size={14} strokeWidth={1.5} />
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
