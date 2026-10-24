import { setSentryEnabled, useSentryEnabled } from "../crashReporting";
import { toast } from "../../toast";
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
  const enabled = useSentryEnabled();

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.crash} />
      <CfgBlank />

      <CfgSection name="telemetry" />
      <CfgRow
        name="crashReporting"
        comment="Send error messages, stack traces, and app/version details to help improve Husk. Error text can contain diagnostic information. Changes take effect immediately in every open window."
      >
        <CfgBool value={enabled} onChange={(value) => {
          if (!setSentryEnabled(value)) toast({ variant: "error", title: "Privacy choice could not be saved", message: "Reporting is off in this window. Retry to save the choice for other windows and future launches." });
        }} />
      </CfgRow>
    </ConfigEditor>
  );
}
