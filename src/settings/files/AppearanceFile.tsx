import { useCallback, useMemo, useState, type ReactNode } from "react";
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
  CfgBlock,
  CfgBool,
  CfgColor,
  CfgEnum,
  CfgSlider,
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

function AppearanceControl({
  label,
  description,
  children,
  wide = false,
  className = "",
}: {
  label: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
  className?: string;
}) {
  return (
    <div className={`appearance-control${wide ? " is-wide" : ""}${className ? ` ${className}` : ""}`}>
      <div className="appearance-control-copy">
        <strong>{label}</strong>
        <small>{description}</small>
      </div>
      <div className="appearance-control-value">{children}</div>
    </div>
  );
}

export function AppearanceFile() {
  const p = usePrefs();
  /* Custom presets are mirrored from config.toml into the synchronous browser
     cache, so a tick forces the list to re-read after a save or delete. */
  const [presetTick, setPresetTick] = useState(0);
  const [newPresetName, setNewPresetName] = useState("");
  const presets = useMemo(() => allPresets(), [presetTick]);
  const bg = p.background;

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
  const previewImage = selectedBuiltIn?.src ?? (bg.path || undefined);
  const currentLook = [
    p.frostedGlass ? "frosted panels" : "solid panels",
    `${p.panelGaps}px gaps`,
    `${p.aiPanelDock} composer`,
  ].join(" · ");

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.appearance} />
      <div className="appearance-workbench">
        <section className="appearance-current-look" aria-label="Current appearance">
          <div
            className="appearance-current-preview"
            style={previewImage ? { backgroundImage: `url("${previewImage}")` } : undefined}
            aria-hidden="true"
          >
            <span>live look</span>
          </div>
          <div className="appearance-current-copy">
            <p className="appearance-section-kicker">CURRENT LOOK</p>
            <h2>{bg.enabled ? fileName ?? "Husk default" : "Wallpaper off"}</h2>
            <p>{currentLook}</p>
            <span className="appearance-current-accent"><i style={{ background: p.accentColor }} />{p.accentColor}</span>
          </div>
        </section>

        <section className="appearance-workbench-section">
          <header className="appearance-section-head">
            <div>
              <p className="appearance-section-kicker">PRESETS</p>
              <h3>Start from a look</h3>
              <small>Apply a complete look in one click. Your wallpaper image is kept.</small>
            </div>
          </header>
          <div className="appearance-preset-list">
            {presets.map((preset) => (
              <div key={preset.id} className="appearance-preset">
                <button
                  type="button"
                  className="appearance-preset-apply"
                  onClick={() => {
                    applyAppearancePreset(preset);
                    setPresetTick((n) => n + 1);
                  }}
                >
                  <span><strong>{preset.name}</strong><small>{preset.description}</small></span>
                  <em>apply ›</em>
                </button>
                {preset.custom ? (
                  <button
                    type="button"
                    className="appearance-preset-delete"
                    aria-label={`Delete ${preset.name} preset`}
                    onClick={() => {
                      deleteCustomPreset(preset.id);
                      setPresetTick((n) => n + 1);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
            <form
              className="appearance-preset-save"
              onSubmit={(event) => {
                event.preventDefault();
                if (!saveCurrentAsPreset(newPresetName)) return;
                setNewPresetName("");
                setPresetTick((n) => n + 1);
              }}
            >
              <input value={newPresetName} onChange={(event) => setNewPresetName(event.target.value)} placeholder="name this look" aria-label="Preset name" />
              <button type="submit">save current ›</button>
            </form>
          </div>
        </section>

        <section className="appearance-workbench-section">
          <header className="appearance-section-head">
            <div>
              <p className="appearance-section-kicker">THEME</p>
              <h3>Color language</h3>
              <small>Set the accent that threads through your active state and controls.</small>
            </div>
          </header>
          <div className="appearance-control-grid">
            <AppearanceControl label="Accent" description="Primary accent color. Click a swatch to change." wide className="appearance-accent-control">
              <CfgColor value={p.accentColor} onChange={(accentColor) => setPrefs({ accentColor })} presets={PRESET_COLORS} />
            </AppearanceControl>
          </div>
        </section>

        <section className="appearance-workbench-section">
          <header className="appearance-section-head appearance-section-head--actions">
            <div>
              <p className="appearance-section-kicker">WALLPAPER</p>
              <h3>Set the atmosphere</h3>
              <small>Readability-first backgrounds made for Husk, or use an image from your machine.</small>
            </div>
            <div className="appearance-section-actions">
              <CfgAct onClick={pickImage}>choose image</CfgAct>
              {bg.path ? <CfgAct onClick={clearImage} danger>clear</CfgAct> : null}
            </div>
          </header>
          <div className="appearance-wallpaper-status">
            <div className="appearance-wallpaper-status-preview" style={previewImage ? { backgroundImage: `url("${previewImage}")` } : undefined} />
            <div>
              <strong>{fileName ?? "No image selected"}</strong>
              <small>{selectedBuiltIn ? "Built into Husk" : bg.path ? "From this device" : "Choose a Husk wallpaper or an image from your machine"}</small>
            </div>
          </div>
          <div className="cfg-wallpaper-gallery appearance-wallpaper-gallery" role="list" aria-label="Husk built-in wallpapers">
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
                  <span className="cfg-wallpaper-preview" style={{ backgroundImage: `url("${wallpaper.src}")` }} aria-hidden="true" />
                  <span className="cfg-wallpaper-card-copy"><span>{wallpaper.name}</span><small>{wallpaper.description}</small></span>
                </button>
              );
            })}
          </div>
          <div className="appearance-control-grid">
            <AppearanceControl label="Enabled" description="Show a custom image behind the terminal and editor.">
              <CfgBool value={bg.enabled} onChange={(value) => patchBg({ enabled: value })} />
            </AppearanceControl>
            <AppearanceControl label="Fit" description="Cover fills the window; contain shows the whole image.">
              <CfgEnum value={bg.fit} options={[{ value: "cover" as const, label: "cover (fill)" }, { value: "contain" as const, label: "contain (fit)" }]} onChange={(fit) => patchBg({ fit })} />
            </AppearanceControl>
            <AppearanceControl label="Opacity" description="Wallpaper visibility.">
              <CfgSlider value={bg.opacity} min={10} max={100} step={5} onChange={(opacity) => patchBg({ opacity })} />
            </AppearanceControl>
            <AppearanceControl label="Blur" description="Wallpaper softness.">
              <CfgSlider value={bg.blur} min={0} max={20} step={1} unit="px" onChange={(blur) => patchBg({ blur })} />
            </AppearanceControl>
            <AppearanceControl label="Editor opacity" description="Code area wallpaper transparency.">
              <CfgSlider value={p.editorWallpaperOpacity} min={0} max={50} step={5} onChange={(editorWallpaperOpacity) => setPrefs({ editorWallpaperOpacity })} />
            </AppearanceControl>
            <AppearanceControl label="Wallpaper folder" description={bg.dir ? "Switch with ⌘/Ctrl+Shift+B or from the launcher (wall:)." : "Optional. Pick a folder, then switch anytime with ⌘/Ctrl+Shift+B or from the launcher (wall:)."} wide>
              <span className="appearance-folder-value">{bg.dir ? bg.dir.split(/[\\/]/).pop() ?? bg.dir : "No folder"}</span>
              <CfgAct onClick={pickFolder}>pick folder</CfgAct>
              {bg.dir ? <CfgAct onClick={() => patchBg({ dir: "" })} danger>clear</CfgAct> : null}
            </AppearanceControl>
          </div>
        </section>

        <section className="appearance-workbench-section">
          <header className="appearance-section-head">
            <div>
              <p className="appearance-section-kicker">PANEL TREATMENT</p>
              <h3>Shape the workspace</h3>
              <small>These controls work together to make panels either calm and solid or layered and atmospheric.</small>
            </div>
          </header>
          <div className="appearance-control-grid">
            <AppearanceControl label="Animations" description="Panel and menu transitions. Turn off to reduce motion."><CfgBool value={p.animationsEnabled} onChange={(animationsEnabled) => setPrefs({ animationsEnabled })} /></AppearanceControl>
            <AppearanceControl label="Frosted glass" description="Backdrop blur on panels."><CfgBool value={p.frostedGlass} onChange={(frostedGlass) => setPrefs({ frostedGlass })} /></AppearanceControl>
            <AppearanceControl label="Neon border glow" description="Active panel glow."><CfgBool value={p.neonBorderGlow} onChange={(neonBorderGlow) => setPrefs({ neonBorderGlow })} /></AppearanceControl>
            <AppearanceControl label="Panel shadows" description="Drop shadow under each panel. Visible when panel gaps are above zero."><CfgBool value={p.panelShadows} onChange={(panelShadows) => setPrefs({ panelShadows })} /></AppearanceControl>
            <AppearanceControl label="Active panel glow" description="Tint the gap around whichever panel has focus."><CfgBool value={p.activePanelGlow} onChange={(activePanelGlow) => setPrefs({ activePanelGlow })} /></AppearanceControl>
            <AppearanceControl label="Panel gaps" description="Padding between panels."><CfgSlider value={p.panelGaps} min={0} max={12} step={1} unit="px" onChange={(panelGaps) => setPrefs({ panelGaps })} /></AppearanceControl>
            <AppearanceControl label="Gap pattern" description="Pattern in panel gaps."><CfgEnum value={p.panelGapStyle} onChange={(panelGapStyle) => setPrefs({ panelGapStyle })} options={[{ value: "none", label: "None" }, { value: "dots", label: "Dots" }, { value: "grid", label: "Grid" }, { value: "cross", label: "Cross" }, { value: "gradient", label: "Gradient" }]} /></AppearanceControl>
          </div>
        </section>

        <section className="appearance-workbench-section">
          <header className="appearance-section-head">
            <div>
              <p className="appearance-section-kicker">COMPOSER</p>
              <h3>Set the AI surface</h3>
              <small>Control where the AI composer appears and how it holds up over your wallpaper.</small>
            </div>
          </header>
          <div className="appearance-control-grid">
            <AppearanceControl label="Dock" description="Which side the AI panel sits on, in both the terminal and editor."><CfgEnum<"left" | "right"> value={p.aiPanelDock} onChange={(aiPanelDock) => setPrefs({ aiPanelDock })} options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} /></AppearanceControl>
            <AppearanceControl label="Opacity" description="Composer background transparency."><CfgSlider value={p.aiMiniOpacity} min={10} max={100} step={5} onChange={(aiMiniOpacity) => setPrefs({ aiMiniOpacity })} /></AppearanceControl>
            <AppearanceControl label="Text size" description="AI composer text size, in pixels."><CfgSlider value={p.aiMiniFontSize} min={9} max={18} step={1} unit="px" onChange={(aiMiniFontSize) => setPrefs({ aiMiniFontSize })} /></AppearanceControl>
            <AppearanceControl label="Background blur" description="Blur behind the AI composer."><CfgSlider value={p.aiMiniBgBlur} min={0} max={20} step={1} unit="px" onChange={(aiMiniBgBlur) => setPrefs({ aiMiniBgBlur })} /></AppearanceControl>
            <AppearanceControl label="Background dim" description="Darken behind the AI composer so text stays readable over a wallpaper."><CfgSlider value={p.aiMiniBgDim} min={0} max={90} step={5} onChange={(aiMiniBgDim) => setPrefs({ aiMiniBgDim })} /></AppearanceControl>
            <AppearanceControl label="Background style" description="Follow the theme, use a gradient, or a solid colour."><CfgEnum value={p.aiComposerBgStyle} onChange={(aiComposerBgStyle) => setPrefs({ aiComposerBgStyle })} options={[{ value: "default", label: "Default" }, { value: "gradient", label: "Gradient" }, { value: "solid", label: "Solid" }]} /></AppearanceControl>
            <AppearanceControl label="Background color" description="Used by gradient or solid."><CfgColor value={p.aiComposerBgColor} onChange={(aiComposerBgColor) => setPrefs({ aiComposerBgColor })} /></AppearanceControl>
          </div>
        </section>

        <details className="appearance-custom-css">
          <summary><span>Custom CSS</span><small>Global overrides for advanced customisation</small></summary>
          <div>
            <p>Inject custom CSS rules. Applied globally — use with care.</p>
            <CfgBlock value={p.customCSS || ""} onChange={(customCSS) => setPrefs({ customCSS })} placeholder={"/* Example: make terminal text larger */\n.terminal-host { font-size: 14px; }"} rows={6} />
          </div>
        </details>
      </div>
    </ConfigEditor>
  );
}
