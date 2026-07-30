import { useEffect, useState } from "react";
import { getSentryEnabled, setSentryEnabled } from "../CrashReportingSection";
import {
  ConfigEditor,
  CfgBlank,
  CfgBool,
  CfgComment,
  CfgRow,
  CfgSection,
} from "../config/controls";

export function CrashFile() {
  const [enabled, setEnabled] = useState(getSentryEnabled());

  useEffect(() => {
    setSentryEnabled(enabled);
  }, [enabled]);

  return (
    <ConfigEditor>
      <CfgComment>──────────────────────────────────────────</CfgComment>
      <CfgComment>crash.toml — error reporting</CfgComment>
      <CfgComment>──────────────────────────────────────────</CfgComment>
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
