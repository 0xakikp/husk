import { useCallback, useEffect, useState } from "react";
import { usePrefs, setPrefs } from "../preferences";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ConfigEditor,
  CfgAct,
  CfgBlank,
  CfgBlock,
  CfgBool,
  CfgColor,
  CfgComment,
  CfgEnum,
  CfgRow,
  CfgSection,
  CfgSlider,
  CfgStr,
} from "../config/controls";

const PRESET_COLORS = [
  "#11c700",
  "#00d4ff",
  "#ff6b9d",
  "#f1c40f",
  "#e74c3c",
  "#9b59b6",
  "#3498db",
  "#e67e22",
  "#1abc9c",
  "#ff79c6",
];

export function AppearanceFile() {
  const p = usePrefs();
  const bg = p.background;

  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => setTtsVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.addEventListener("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);

  const testVoice = () => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance("Hi, I'm Husk — your AI assistant.");
    const v =
      ttsVoices.find((v) => v.name === p.aiTtsVoice) ??
      ttsVoices.find((v) => /samantha|victoria|karen|moira|tessa|fiona|zira|serena/i.test(v.name));
    if (v) u.voice = v;
    u.rate = 1.05;
    u.pitch = 1.1;
    window.speechSynthesis.speak(u);
  };

  const pickImage = useCallback(async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (selected && typeof selected === "string") {
      setPrefs({ background: { ...bg, enabled: true, path: selected } });
    }
  }, [bg]);

  const clearImage = useCallback(() => {
    setPrefs({ background: { ...bg, enabled: false, path: "" } });
  }, [bg]);

  const patchBg = useCallback(
    (patch: Partial<typeof bg>) => {
      setPrefs({ background: { ...bg, ...patch } });
    },
    [bg],
  );

  const fileName = bg.path ? bg.path.split(/[\\/]/).pop() : null;

  return (
    <ConfigEditor>
      <CfgComment>──────────────────────────────────────────</CfgComment>
      <CfgComment>appearance.toml — colors, effects, layout</CfgComment>
      <CfgComment>──────────────────────────────────────────</CfgComment>
      <CfgBlank />

      <CfgSection name="theme" />
      <CfgRow name="accent" comment="Primary accent color. Click a swatch to change.">
        <CfgColor
          value={p.accentColor}
          onChange={(accentColor) => setPrefs({ accentColor })}
          presets={PRESET_COLORS}
        />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="wallpaper" />
      <CfgRow name="enabled" comment="Show a custom image behind the terminal and editor.">
        <CfgBool value={bg.enabled} onChange={(v) => patchBg({ enabled: v })} />
      </CfgRow>
      <CfgRow name="path" comment={fileName ? undefined : "No image selected."}>
        <CfgStr>{fileName ?? ""}</CfgStr>
        <CfgAct onClick={pickImage}>pick</CfgAct>
        {bg.path ? <CfgAct onClick={clearImage} danger>clear</CfgAct> : null}
      </CfgRow>
      <CfgRow name="opacity" comment="Wallpaper visibility.">
        <CfgSlider value={bg.opacity} min={10} max={100} step={5} onChange={(v) => patchBg({ opacity: v })} />
      </CfgRow>
      <CfgRow name="blur" comment="Wallpaper softness.">
        <CfgSlider value={bg.blur} min={0} max={20} step={1} unit="px" onChange={(v) => patchBg({ blur: v })} />
      </CfgRow>
      <CfgRow name="dim" comment="Dark overlay strength.">
        <CfgSlider value={bg.dim} min={0} max={90} step={5} onChange={(v) => patchBg({ dim: v })} />
      </CfgRow>
      <CfgRow name="editorOpacity" comment="Code area wallpaper transparency.">
        <CfgSlider
          value={p.editorWallpaperOpacity}
          min={0}
          max={50}
          step={5}
          onChange={(v) => setPrefs({ editorWallpaperOpacity: v })}
        />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="effects" />
      <CfgRow name="animations">
        <CfgBool value={p.animationsEnabled} onChange={(v) => setPrefs({ animationsEnabled: v })} />
      </CfgRow>
      <CfgRow name="frostedGlass" comment="Backdrop blur on panels.">
        <CfgBool value={p.frostedGlass} onChange={(v) => setPrefs({ frostedGlass: v })} />
      </CfgRow>
      <CfgRow name="neonBorderGlow" comment="Active panel glow.">
        <CfgBool value={p.neonBorderGlow} onChange={(v) => setPrefs({ neonBorderGlow: v })} />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="layout" />
      <CfgRow name="panelGaps" comment="Padding between panels.">
        <CfgSlider value={p.panelGaps} min={0} max={12} step={1} unit="px" onChange={(v) => setPrefs({ panelGaps: v })} />
      </CfgRow>
      <CfgRow name="gapStyle" comment="Pattern in panel gaps.">
        <CfgEnum
          value={p.panelGapStyle}
          onChange={(panelGapStyle) => setPrefs({ panelGapStyle })}
          options={[
            { value: "none", label: "None" },
            { value: "dots", label: "Dots" },
            { value: "grid", label: "Grid" },
            { value: "cross", label: "Cross" },
            { value: "gradient", label: "Gradient" },
          ]}
        />
      </CfgRow>
      <CfgRow name="panelShadows">
        <CfgBool value={p.panelShadows} onChange={(v) => setPrefs({ panelShadows: v })} />
      </CfgRow>
      <CfgRow name="activePanelGlow">
        <CfgBool value={p.activePanelGlow} onChange={(v) => setPrefs({ activePanelGlow: v })} />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="composer" />
      <CfgRow name="opacity" comment="Composer background transparency.">
        <CfgSlider value={p.aiMiniOpacity} min={10} max={100} step={5} onChange={(v) => setPrefs({ aiMiniOpacity: v })} />
      </CfgRow>
      <CfgRow name="fontSize">
        <CfgSlider value={p.aiMiniFontSize} min={9} max={18} step={1} unit="px" onChange={(v) => setPrefs({ aiMiniFontSize: v })} />
      </CfgRow>
      <CfgRow name="bgBlur">
        <CfgSlider value={p.aiMiniBgBlur} min={0} max={20} step={1} unit="px" onChange={(v) => setPrefs({ aiMiniBgBlur: v })} />
      </CfgRow>
      <CfgRow name="bgDim">
        <CfgSlider value={p.aiMiniBgDim} min={0} max={90} step={5} onChange={(v) => setPrefs({ aiMiniBgDim: v })} />
      </CfgRow>
      <CfgRow name="bgStyle">
        <CfgEnum
          value={p.aiComposerBgStyle}
          onChange={(aiComposerBgStyle) => setPrefs({ aiComposerBgStyle })}
          options={[
            { value: "default", label: "Default" },
            { value: "gradient", label: "Gradient" },
            { value: "solid", label: "Solid" },
          ]}
        />
      </CfgRow>
      <CfgRow name="bgColor" comment="Used by gradient / solid.">
        <CfgColor value={p.aiComposerBgColor} onChange={(v) => setPrefs({ aiComposerBgColor: v })} />
      </CfgRow>
      <CfgRow name="talkBackVoice" comment="Voice used when reading AI replies aloud.">
        <CfgEnum
          value={p.aiTtsVoice}
          onChange={(aiTtsVoice) => setPrefs({ aiTtsVoice })}
          options={[
            { value: "", label: "Auto (female)" },
            ...ttsVoices.map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` })),
          ]}
        />
        <CfgAct onClick={testVoice}>test</CfgAct>
      </CfgRow>
      <CfgBlank />

      <CfgSection name="custom_css" />
      <CfgComment>Inject custom CSS rules. Applied globally — use with care.</CfgComment>
      <CfgRow>
        <CfgBlock
          value={p.customCSS || ""}
          onChange={(customCSS) => setPrefs({ customCSS })}
          placeholder={"/* Example: make terminal text larger */\n.terminal-host { font-size: 14px; }"}
          rows={6}
        />
      </CfgRow>
    </ConfigEditor>
  );
}
