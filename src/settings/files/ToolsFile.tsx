import { useState } from "react";
import { SetupAssistantBanner, SetupAssistantDialog } from "../SetupAssistantDialog";
import {
  ConfigEditor,
  CfgArt,
  CfgAct,
  CfgBlank,
  CfgComment,
  CfgRow,
  CfgSection,
} from "../config/controls";
import { BANNERS } from "../config/banners";

export function ToolsFile() {
  const [setupOpen, setSetupOpen] = useState(false);

  return (
    <>
      <ConfigEditor>
      <CfgArt lines={BANNERS.tools} />
        <CfgBlank />
        <CfgComment>eza, bat, fzf, zoxide, lazygit, starship, and more.</CfgComment>
        <CfgComment>husk detects what you have and pastes install</CfgComment>
        <CfgComment>commands into the active terminal.</CfgComment>
        <CfgBlank />

        <CfgSection name="tools" />
        <CfgRow name="setupAssistant" comment="Walk through installing the CLI tools Husk can use (rg, fd, eza, bat, fzf).">
          <CfgAct onClick={() => setSetupOpen(true)}>open setup assistant</CfgAct>
        </CfgRow>
      </ConfigEditor>

      <div className="px-4 pb-6">
        <SetupAssistantBanner onOpen={() => setSetupOpen(true)} />
      </div>

      <SetupAssistantDialog open={setupOpen} onOpenChange={setSetupOpen} />
    </>
  );
}
