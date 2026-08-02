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

      <CfgSection name="the_night_it_started" />
      <CfgComment>It is late, and something is broken.</CfgComment>
      <CfgBlank />
      <CfgComment>You ssh in. The logs point at a pod that keeps restarting, so you</CfgComment>
      <CfgComment>open a browser tab for the cluster — and the dashboard asks you to</CfgComment>
      <CfgComment>pick the context you set in the terminal nine seconds ago. You find</CfgComment>
      <CfgComment>the pod. It is unhappy about a config file, so you open an editor,</CfgComment>
      <CfgComment>which has no idea where you have been, so you paste the path in by</CfgComment>
      <CfgComment>hand. In a fourth window there is a chat box you are now describing</CfgComment>
      <CfgComment>all of this to, because it cannot see any of it either.</CfgComment>
      <CfgBlank />
      <CfgComment>Four windows. One question.</CfgComment>
      <CfgBlank />
      <CfgComment>None of those tools are bad. They are just strangers to one</CfgComment>
      <CfgComment>another — and you are the integration layer, carrying paths,</CfgComment>
      <CfgComment>contexts and half-remembered output between them by hand, at 2am,</CfgComment>
      <CfgComment>while the thing you were actually trying to fix waits.</CfgComment>
      <CfgBlank />

      <CfgSection name="so_we_started_elsewhere" />
      <CfgComment>Husk begins from the other end. The shell is not a panel tucked</CfgComment>
      <CfgComment>into a corner — it is the app. Everything else has to earn its</CfgComment>
      <CfgComment>place beside it, and the price of admission is knowing where you</CfgComment>
      <CfgComment>already are.</CfgComment>
      <CfgBlank />
      <CfgComment>So the cluster is a sidebar, already on your context. The file the</CfgComment>
      <CfgComment>last command printed opens in a pane, not a new application. The AI</CfgComment>
      <CfgComment>sits against the terminal and can read what is on screen, which</CfgComment>
      <CfgComment>means you stop narrating output you could simply point at.</CfgComment>
      <CfgBlank />
      <CfgComment>Underneath it is Rust and Tauri, so the PTY is a real PTY and the</CfgComment>
      <CfgComment>binary stays small. React sits on top, where it earns its keep.</CfgComment>
      <CfgBlank />

      <CfgSection name="what_it_refuses_to_do" />
      <CfgComment>It will not make the terminal smaller for a feature nobody asked</CfgComment>
      <CfgComment>for. It will not send your keys anywhere — they stay in the OS</CfgComment>
      <CfgComment>keychain, and the AI reaches nothing outside your workspace unless</CfgComment>
      <CfgComment>you say so. It will not touch a file before showing you the diff,</CfgComment>
      <CfgComment>or run something dangerous without stopping to ask.</CfgComment>
      <CfgBlank />
      <CfgComment>And it will not decide how it should look. That part is yours.</CfgComment>
      <CfgBlank />

      <CfgSection name="what_came_of_it" />
      <CfgComment>Tabs, splits and a history you can actually search. Monaco for when</CfgComment>
      <CfgComment>you need a real editor, with vim mode if that is how you think.</CfgComment>
      <CfgComment>Panels for Kubernetes, Docker, Terraform, CI/CD and Tailscale.</CfgComment>
      <CfgComment>Saved SSH connections, SFTP and port forwards. Workflows, for the</CfgComment>
      <CfgComment>five-command dance you rerun every week. One launcher over all of</CfgComment>
      <CfgComment>it. And MCP, for the day you want the AI to reach a tool we have</CfgComment>
      <CfgComment>never heard of.</CfgComment>
      <CfgBlank />
      <CfgComment>None of it is finished. That is rather the point of a manifest.</CfgComment>
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
