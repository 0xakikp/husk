import { useState } from "react";
import { SetupAssistantView } from "../SetupAssistantDialog";
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
  const [showSetupAssistant, setShowSetupAssistant] = useState(false);

  if (showSetupAssistant) {
    return <SetupAssistantView onBack={() => setShowSetupAssistant(false)} />;
  }

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.tools} />
      <CfgBlank />
      <CfgComment>eza, bat, fzf, zoxide, lazygit, starship, and more.</CfgComment>
      <CfgComment>husk detects what you have and pastes install</CfgComment>
      <CfgComment>commands into the active terminal.</CfgComment>
      <CfgBlank />

      <CfgSection name="tools" />
      <CfgRow name="setupAssistant" comment="Browse optional CLI tools, check what is installed, and copy install commands.">
        <CfgAct onClick={() => setShowSetupAssistant(true)}>open setup assistant</CfgAct>
      </CfgRow>
    </ConfigEditor>
  );
}
