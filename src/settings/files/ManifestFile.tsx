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

      <CfgSection name="links" />
      <CfgRow>
        <CfgAct onClick={() => void checkForUpdates(true)}>check for updates</CfgAct>
        <CfgAct onClick={() => void openUrl(REPO_URL)}>github</CfgAct>
        <CfgAct onClick={() => void openUrl(FEEDBACK_URL)}>feedback</CfgAct>
        <CfgAct onClick={() => void openUrl(BUY_ME_A_COFFEE_URL)}>support</CfgAct>
      </CfgRow>
      <CfgBlank />

      <CfgSection name="overview" />
      <CfgComment>Husk is a terminal-first development environment for the desktop.</CfgComment>
      <CfgComment>It combines a full terminal emulator, a code editor, an AI</CfgComment>
      <CfgComment>assistant and infrastructure tooling in a single application, so</CfgComment>
      <CfgComment>that work normally spread across a terminal, a browser dashboard,</CfgComment>
      <CfgComment>an editor and a chat window happens in one place.</CfgComment>
      <CfgBlank />
      <CfgComment>Sessions run on a native PTY. The application is built with Rust</CfgComment>
      <CfgComment>and Tauri with a React interface, and ships for macOS, Windows and</CfgComment>
      <CfgComment>Linux.</CfgComment>
      <CfgBlank />

      <CfgSection name="designed_for" />
      <CfgComment>Engineers who spend most of the working day in a shell — platform</CfgComment>
      <CfgComment>and infrastructure teams, SREs, and backend developers whose work</CfgComment>
      <CfgComment>runs through ssh, kubectl, docker, terraform and git.</CfgComment>
      <CfgBlank />

      <CfgSection name="capabilities" />
      <CfgRow name="terminal">
        <CfgStr>Tabs, splits, shell integration, searchable history</CfgStr>
      </CfgRow>
      <CfgRow name="ai">
        <CfgStr>Assistant docked beside the shell, with terminal and file context</CfgStr>
      </CfgRow>
      <CfgRow name="editor">
        <CfgStr>Monaco, with optional vim mode</CfgStr>
      </CfgRow>
      <CfgRow name="kubernetes">
        <CfgStr>Contexts, workloads, logs and resource inspection</CfgStr>
      </CfgRow>
      <CfgRow name="containers">
        <CfgStr>Docker images, containers and logs</CfgStr>
      </CfgRow>
      <CfgRow name="infrastructure">
        <CfgStr>Terraform state, CI/CD pipelines, Tailscale devices</CfgStr>
      </CfgRow>
      <CfgRow name="remote">
        <CfgStr>Saved SSH connections, SFTP, port forwarding</CfgStr>
      </CfgRow>
      <CfgRow name="automation">
        <CfgStr>Multi-step workflows, runnable from any terminal</CfgStr>
      </CfgRow>
      <CfgRow name="search">
        <CfgStr>One launcher across files, history, notes and actions</CfgStr>
      </CfgRow>
      <CfgRow name="extensibility">
        <CfgStr>MCP servers, to give the assistant external tools</CfgStr>
      </CfgRow>
      <CfgBlank />

      <CfgSection name="security" />
      <CfgComment>API keys are stored in the operating system keychain, never in</CfgComment>
      <CfgComment>application config. Assistant file access is confined to the open</CfgComment>
      <CfgComment>workspace. File edits are presented as a diff for review before</CfgComment>
      <CfgComment>they are applied, and commands identified as destructive require</CfgComment>
      <CfgComment>explicit confirmation.</CfgComment>
      <CfgBlank />

      <CfgSection name="status" />
      <CfgComment>Under active development. Issues and feature requests are welcome</CfgComment>
      <CfgComment>on GitHub.</CfgComment>
    </ConfigEditor>
  );
}
