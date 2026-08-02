import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdates } from "../../updater";
import {
  ConfigEditor,
  CfgAct,
  CfgArt,
  CfgBlank,
  CfgComment,
  CfgRow,
  CfgSection,
  CfgStr,
} from "../config/controls";
import { BANNERS } from "../config/banners";

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

export function ManifestFile() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0"));
  }, []);

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.manifest} />
      <CfgBlank />

      <CfgSection name="husk" />
      <CfgRow name="name">
        <img src="/logo.png" alt="" className="cfg-logo" draggable={false} />
        <CfgStr>Husk</CfgStr>
      </CfgRow>
      <CfgRow name="version">
        <CfgStr>{version || "—"}</CfgStr>
      </CfgRow>
      <CfgRow name="tagline">
        <CfgStr>Intelligence, stripped to the shell.</CfgStr>
      </CfgRow>
      <CfgRow name="build">
        <CfgStr>{platformLabel()}</CfgStr>
      </CfgRow>
      <CfgRow name="maker">
        <CfgStr>@akikp</CfgStr>
      </CfgRow>
      <CfgRow name="license">
        <CfgStr>Apache 2.0</CfgStr>
      </CfgRow>
      <CfgBlank />

      <CfgSection name="about" />
      <CfgComment>Husk is a terminal that happens to be an IDE, not an IDE with a</CfgComment>
      <CfgComment>terminal bolted on. The shell is the main surface; the editor, the</CfgComment>
      <CfgComment>file tree and the AI panel are things you pull up beside it.</CfgComment>
      <CfgBlank />
      <CfgComment>It is a desktop app — Tauri and a Rust core, so the PTY is a real</CfgComment>
      <CfgComment>PTY and the binary stays small, with a React front end for the parts</CfgComment>
      <CfgComment>that benefit from one.</CfgComment>
      <CfgBlank />

      <CfgSection name="why" />
      <CfgComment>The work that pays the bills happens in a shell: ssh, kubectl,</CfgComment>
      <CfgComment>docker, terraform, git. Every tool around that shell assumes you</CfgComment>
      <CfgComment>would rather be somewhere else — a browser tab for the cluster, a</CfgComment>
      <CfgComment>desktop app for the containers, a second editor for the file you</CfgComment>
      <CfgComment>just grepped. Each one is a context switch you did not ask for.</CfgComment>
      <CfgBlank />
      <CfgComment>Husk pulls those back to where the work already is. Inspect a pod</CfgComment>
      <CfgComment>without leaving the prompt. Open the file the last command printed.</CfgComment>
      <CfgComment>Ask about output that is still on screen, in the pane beside it.</CfgComment>
      <CfgBlank />

      <CfgSection name="principles" />
      <CfgComment>Terminal first. If a feature makes the terminal smaller for no</CfgComment>
      <CfgComment>reason, it does not ship.</CfgComment>
      <CfgComment>Local by default. Your keys live in the OS keychain; the AI reaches</CfgComment>
      <CfgComment>nothing outside the workspace without being told to.</CfgComment>
      <CfgComment>No surprises. Destructive commands ask first. Edits are shown as a</CfgComment>
      <CfgComment>diff before they are applied.</CfgComment>
      <CfgComment>Yours to shape. Themes, fonts, gaps, docks and panels are settings,</CfgComment>
      <CfgComment>not opinions.</CfgComment>
      <CfgBlank />

      <CfgSection name="inside" />
      <CfgComment>terminal — tabs, splits, shell integration, searchable history</CfgComment>
      <CfgComment>ai — chat docked beside the shell, with terminal and file context</CfgComment>
      <CfgComment>editor — Monaco, with vim mode if you want it</CfgComment>
      <CfgComment>infra — Kubernetes, Docker, Terraform, CI/CD and Tailscale panels</CfgComment>
      <CfgComment>remotes — saved SSH connections, SFTP and port forwards</CfgComment>
      <CfgComment>workflows — multi-step commands saved and run from any terminal</CfgComment>
      <CfgComment>spotlight — one launcher over files, history, notes and actions</CfgComment>
      <CfgComment>mcp — connect external tool servers to the AI</CfgComment>
      <CfgBlank />

      <CfgSection name="links" />
      <CfgRow>
        <CfgAct onClick={() => void checkForUpdates(true)}>check for updates</CfgAct>
        <CfgAct onClick={() => void openUrl(REPO_URL)}>github</CfgAct>
        <CfgAct onClick={() => void openUrl(FEEDBACK_URL)}>feedback</CfgAct>
        <CfgAct onClick={() => void openUrl(BUY_ME_A_COFFEE_URL)}>support</CfgAct>
      </CfgRow>
    </ConfigEditor>
  );
}
