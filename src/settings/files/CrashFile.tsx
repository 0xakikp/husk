import { useEffect, useState } from "react";
import { getSentryEnabled, setSentryEnabled } from "../crashReporting";
import {
  ConfigEditor,
  CfgArt,
  CfgBlank,
  CfgBool,
  CfgRow,
  CfgSection,
} from "../config/controls";
import { BANNERS } from "../config/banners";

export function CrashFile() {
  const [enabled, setEnabled] = useState(getSentryEnabled());

  useEffect(() => {
    setSentryEnabled(enabled);
  }, [enabled]);

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.crash} />
      <CfgBlank />

      <CfgSection name="telemetry" />
      <CfgRow
        name="crashReporting"
        comment="Automatically send error reports to help improve Husk. No personal data or commands are included."
      >
        <CfgBool value={enabled} onChange={setEnabled} />
      </CfgRow>
    </ConfigEditor>
  );
}
