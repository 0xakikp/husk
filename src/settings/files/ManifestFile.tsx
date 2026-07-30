import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { checkForUpdates } from "../../updater";
import {
  ConfigEditor,
  CfgAct,
  CfgBlank,
  CfgComment,
  CfgRow,
  CfgSection,
  CfgStr,
} from "../config/controls";

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
      <CfgComment>──────────────────────────────────────────</CfgComment>
      <CfgComment>manifest.toml — about this build</CfgComment>
      <CfgComment>──────────────────────────────────────────</CfgComment>
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
    </ConfigEditor>
  );
}
