import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs, setPrefs } from "../preferences";
import {
  allPresets,
  applyAppearancePreset,
  saveCurrentAsPreset,
  deleteCustomPreset,
} from "../appearancePresets";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  ConfigEditor,
  CfgArt,
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
  CfgText,
  CfgStr,
} from "../config/controls";
import { BANNERS } from "../config/banners";
import {
  BUILT_IN_WALLPAPERS,
  builtInWallpaperPath,
  getBuiltInWallpaper,
  wallpaperName,
  applyWallpaper,
} from "../wallpapers";

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
  /* Custom presets live in localStorage, so a tick forces the list to re-read
     after a save or delete. */
  const [presetTick, setPresetTick] = useState(0);
  const [newPresetName, setNewPresetName] = useState("");
  const presets = useMemo(() => allPresets(), [presetTick]);
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

  const pickFolder = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") {
      setPrefs({ background: { ...bg, dir: selected } });
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

  const selectedBuiltIn = getBuiltInWallpaper(bg.path);
  const fileName = bg.path ? wallpaperName(bg.path) : null;

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.appearance} />
      <CfgBlank />

      {/* Presets first: the fastest path is picking a look rather than tuning
          seventeen individual knobs. Each one states what it does. */}
      <CfgSection name="presets" />
      <CfgComment>Apply a complete look in one click. Your wallpaper image is kept.</CfgComment>
      {presets.map((preset) => (
        <CfgRow key={preset.id} name={preset.name.toLowerCase().replace(/\s+/g, "_")} comment={preset.description}>
          <CfgAct
            onClick={() => {
              applyAppearancePreset(preset);
              setPresetTick((n) => n + 1);
            }}
          >
            apply
          </CfgAct>
          {preset.custom ? (
            <CfgAct
              onClick={() => {
                deleteCustomPreset(preset.id);
                setPresetTick((n) => n + 1);
              }}
            >
              delete
            </CfgAct>
          ) : null}
        </CfgRow>
      ))}
      <CfgRow name="save_current" comment="Name your current settings so you can return to them later.">
        <CfgText value={newPresetName} onChange={setNewPresetName} placeholder="preset name" />
        <CfgAct
          onClick={() => {
            if (!saveCurrentAsPreset(newPresetName)) return;
            setNewPresetName("");
            setPresetTick((n) => n + 1);
          }}
        >
          save
        </CfgAct>
      </CfgRow>
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
      <CfgRow name="path" comment={selectedBuiltIn ? "Built into Husk." : fileName ? undefined : "No image selected."}>
        <CfgStr>{fileName ?? ""}</CfgStr>
        <CfgAct onClick={pickImage}>pick</CfgAct>
        {bg.path ? <CfgAct onClick={clearImage} danger>clear</CfgAct> : null}
      </CfgRow>
      <CfgSection name="huskCollection" />
      <CfgComment>Readability-first backgrounds made for Husk. Select one, or keep using your own image below.</CfgComment>
      <div className="cfg-line cfg-wallpaper-gallery-line">
        <div className="cfg-wallpaper-gallery" role="list" aria-label="Husk built-in wallpapers">
          {BUILT_IN_WALLPAPERS.map((wallpaper) => {
            const selected = selectedBuiltIn?.id === wallpaper.id;
            return (
              <button
                key={wallpaper.id}
                type="button"
                className={`cfg-wallpaper-card${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() => applyWallpaper(builtInWallpaperPath(wallpaper.id))}
              >
                <span
                  className="cfg-wallpaper-preview"
                  style={{ backgroundImage: `url("${wallpaper.src}")` }}
                  aria-hidden="true"
                />
                <span className="cfg-wallpaper-card-copy">
                  <span>{wallpaper.name}</span>
                  <small>{wallpaper.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <CfgRow
        name="folder"
        comment={
          bg.dir
            ? "Switch between images in this folder with ⌘/Ctrl+Shift+B, or from the launcher (wall:)."
            : "Optional. Pick a folder, then switch wallpapers anytime with ⌘/Ctrl+Shift+B or from the launcher (wall:)."
        }
      >
        <CfgStr>{bg.dir ? bg.dir.split(/[\\/]/).pop() ?? bg.dir : ""}</CfgStr>
        <CfgAct onClick={pickFolder}>pick folder</CfgAct>
        {bg.dir ? (
          <CfgAct onClick={() => patchBg({ dir: "" })} danger>
            clear
          </CfgAct>
        ) : null}
      </CfgRow>
      <CfgRow name="fit" comment="cover fills the window and crops the overflow; contain shows the whole image, may leave empty edges.">
        <CfgEnum
          value={bg.fit}
          options={[
            { value: "cover" as const, label: "cover (fill)" },
            { value: "contain" as const, label: "contain (fit)" },
          ]}
          onChange={(v) => patchBg({ fit: v })}
        />
      </CfgRow>
      <CfgRow name="opacity" comment="Wallpaper visibility.">
        <CfgSlider value={bg.opacity} min={10} max={100} step={5} onChange={(v) => patchBg({ opacity: v })} />
      </CfgRow>
      <CfgRow name="blur" comment="Wallpaper softness.">
        <CfgSlider value={bg.blur} min={0} max={20} step={1} unit="px" onChange={(v) => patchBg({ blur: v })} />
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
      <CfgRow name="animations" comment="Panel and menu transitions. Turn off to reduce motion.">
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
      <CfgRow name="panelShadows" comment="Drop shadow under each panel. Only visible when panel gaps are above zero.">
        <CfgBool value={p.panelShadows} onChange={(v) => setPrefs({ panelShadows: v })} />
      </CfgRow>
      <CfgRow name="activePanelGlow" comment="Tint the gap around whichever panel has focus.">
        <CfgBool value={p.activePanelGlow} onChange={(v) => setPrefs({ activePanelGlow: v })} />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="composer" />
      <CfgRow name="dock" comment="Which side the AI panel sits on, in both the terminal and editor.">
        <CfgEnum<"left" | "right">
          value={p.aiPanelDock}
          onChange={(aiPanelDock) => setPrefs({ aiPanelDock })}
          options={[
            { value: "left", label: "Left" },
            { value: "right", label: "Right" },
          ]}
        />
      </CfgRow>
      <CfgRow name="opacity" comment="Composer background transparency.">
        <CfgSlider value={p.aiMiniOpacity} min={10} max={100} step={5} onChange={(v) => setPrefs({ aiMiniOpacity: v })} />
      </CfgRow>
      <CfgRow name="fontSize" comment="AI composer text size, in pixels.">
        <CfgSlider value={p.aiMiniFontSize} min={9} max={18} step={1} unit="px" onChange={(v) => setPrefs({ aiMiniFontSize: v })} />
      </CfgRow>
      <CfgRow name="bgBlur" comment="Blur behind the AI composer.">
        <CfgSlider value={p.aiMiniBgBlur} min={0} max={20} step={1} unit="px" onChange={(v) => setPrefs({ aiMiniBgBlur: v })} />
      </CfgRow>
      <CfgRow name="bgDim" comment="Darken behind the AI composer so text stays readable over a wallpaper.">
        <CfgSlider value={p.aiMiniBgDim} min={0} max={90} step={5} onChange={(v) => setPrefs({ aiMiniBgDim: v })} />
      </CfgRow>
      <CfgRow name="bgStyle" comment="Composer background: follow the theme, a gradient, or a solid colour.">
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
