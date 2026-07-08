import { useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePrefs, setPrefs } from "./preferences";
import { SectionHeader } from "./components/SectionHeader";
import { SettingRow } from "./components/SettingRow";
import { open } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Image02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

const PRESET_COLORS = [
  "#11c700", // husk green
  "#00d4ff", // cyan
  "#ff6b9d", // rose
  "#f1c40f", // yellow
  "#e74c3c", // red
  "#9b59b6", // purple
  "#3498db", // blue
  "#e67e22", // orange
  "#1abc9c", // teal
  "#ff79c6", // pink
];

/** A slider row with title/description on the left and a full-width slider on the right. */
function SliderRow({
  title,
  description,
  value,
  min,
  max,
  step,
  onChange,
}: {
  title: string;
  description: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 px-5 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[12.5px] font-medium text-foreground">{title}</span>
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">{description}</span>
        </div>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground font-mono">
          {value}
        </span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}

/** A switch row inside the grid. */
function SwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <SettingRow
      className="rounded border border-border/40 bg-muted/20 py-2"
      title={title}
      description={description}
    >
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </SettingRow>
  );
}

export function AppearanceSection() {
  const p = usePrefs();
  const bg = p.background;

  const pickImage = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (selected && typeof selected === "string") {
      setPrefs({
        background: { ...bg, enabled: true, path: selected },
      });
    }
  }, [bg]);

  const clearImage = useCallback(() => {
    setPrefs({
      background: { ...bg, enabled: false, path: "" },
    });
  }, [bg]);

  const patchBg = useCallback(
    (patch: Partial<typeof bg>) => {
      setPrefs({ background: { ...bg, ...patch } });
    },
    [bg],
  );

  const fileName = bg.path ? bg.path.split(/[\\/]/).pop() : null;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Appearance" description="Customize colors, effects, animations, and layout." />

      {/* ── Background image ── */}
      <div className="flex flex-col gap-2">
        <Label>Background</Label>

        <SettingRow
          className="rounded border border-border/40 bg-muted/20 py-2"
          title="Background image"
          description="Show a custom image behind the terminal and editor."
        >
          <Switch checked={bg.enabled} onCheckedChange={(v) => patchBg({ enabled: v })} />
        </SettingRow>

        <SettingRow
          className="rounded border border-border/40 bg-muted/20 py-2"
          title="Image file"
          description={fileName ?? "No image selected."}
        >
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Pick image"
              onClick={pickImage}
            >
              <HugeiconsIcon icon={Image02Icon} size={15} strokeWidth={1.75} />
            </Button>
            {bg.path && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 rounded-md text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
                title="Clear image"
                onClick={clearImage}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
              </Button>
            )}
          </div>
        </SettingRow>

        {/* Sliders in 2-column grid */}
        <div className="grid grid-cols-2 gap-2">
          <SliderRow
            title="Opacity"
            description="Wallpaper visibility"
            value={bg.opacity}
            min={10}
            max={100}
            step={5}
            onChange={(v) => patchBg({ opacity: v })}
          />
          <SliderRow
            title="Blur"
            description="Wallpaper softness"
            value={bg.blur}
            min={0}
            max={20}
            step={1}
            onChange={(v) => patchBg({ blur: v })}
          />
          <SliderRow
            title="Dim"
            description="Dark overlay strength"
            value={bg.dim}
            min={0}
            max={90}
            step={5}
            onChange={(v) => patchBg({ dim: v })}
          />
          <SliderRow
            title="Editor wallpaper"
            description="Code area transparency"
            value={p.editorWallpaperOpacity}
            min={0}
            max={50}
            step={5}
            onChange={(v) => setPrefs({ editorWallpaperOpacity: v })}
          />
        </div>
      </div>

      {/* ── Accent color ── */}
      <div className="flex flex-col gap-2">
        <Label>Accent color</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setPrefs({ accentColor: c })}
              className="relative h-7 w-full rounded-md border border-border/40 transition-transform hover:scale-105"
              style={{ backgroundColor: c }}
            >
              {p.accentColor === c && (
                <span className="absolute inset-0 flex items-center justify-center">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={p.accentColor}
            onChange={(e) => setPrefs({ accentColor: e.target.value })}
            className="size-7 cursor-pointer rounded border border-border/40 bg-transparent p-0"
          />
          <span className="text-[11px] text-muted-foreground font-mono">{p.accentColor}</span>
        </div>
      </div>

      {/* ── Effects ── */}
      <div className="flex flex-col gap-2">
        <Label>Effects</Label>
        <div className="grid grid-cols-2 gap-2">
          <SwitchRow
            title="Animations"
            description="Smooth transitions"
            checked={p.animationsEnabled}
            onCheckedChange={(v) => setPrefs({ animationsEnabled: v })}
          />
          <SwitchRow
            title="Frosted glass"
            description="Backdrop blur on panels"
            checked={p.frostedGlass}
            onCheckedChange={(v) => setPrefs({ frostedGlass: v })}
          />
          <SwitchRow
            title="Neon border glow"
            description="Active panel glow"
            checked={p.neonBorderGlow}
            onCheckedChange={(v) => setPrefs({ neonBorderGlow: v })}
          />
        </div>
      </div>

      {/* ── Layout ── */}
      <div className="flex flex-col gap-2">
        <Label>Layout</Label>
        <div className="grid grid-cols-2 gap-2">
          <SliderRow
            title="Panel gaps"
            description="Padding between panels"
            value={p.panelGaps}
            min={0}
            max={12}
            step={1}
            onChange={(v) => setPrefs({ panelGaps: v })}
          />
          <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 px-5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium text-foreground">Gap style</span>
                <span className="text-[10.5px] leading-relaxed text-muted-foreground">Pattern in panel gaps</span>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground font-mono">
                {p.panelGapStyle}
              </span>
            </div>
            <div className="flex gap-1">
              {(["none", "dots", "grid", "cross", "gradient"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setPrefs({ panelGapStyle: style })}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
                    p.panelGapStyle === style
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {style.charAt(0).toUpperCase() + style.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <SwitchRow
            title="Panel shadows"
            description="Floating depth effect"
            checked={p.panelShadows}
            onCheckedChange={(v) => setPrefs({ panelShadows: v })}
          />
          <SwitchRow
            title="Active panel glow"
            description="Highlight focused panel"
            checked={p.activePanelGlow}
            onCheckedChange={(v) => setPrefs({ activePanelGlow: v })}
          />
        </div>
      </div>

      {/* ── Custom CSS ── */}
      <div className="flex flex-col gap-2">
        <Label>Custom CSS</Label>
        <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 px-5 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[12.5px] font-medium text-foreground">User stylesheet</span>
            <span className="text-[10.5px] leading-relaxed text-muted-foreground">
              Inject custom CSS rules. Applied globally — use with care.
            </span>
          </div>
          <textarea
            value={p.customCSS || ""}
            onChange={(e) => setPrefs({ customCSS: e.target.value })}
            placeholder={"/* Example: make terminal text larger */\n.terminal-host { font-size: 14px; }"}
            rows={6}
            className="rounded border border-border/40 bg-background px-3 py-2 text-[11px] font-mono text-foreground"
          />
        </div>
      </div>

      {/* ── AI Composer ── */}
      <div className="flex flex-col gap-2">
        <Label>AI Composer</Label>
        <div className="grid grid-cols-2 gap-2">
          <SliderRow
            title="Panel opacity"
            description="Composer background transparency"
            value={p.aiMiniOpacity}
            min={10}
            max={100}
            step={5}
            onChange={(v) => setPrefs({ aiMiniOpacity: v })}
          />
          <SliderRow
            title="Font size"
            description="Chat text size"
            value={p.aiMiniFontSize}
            min={9}
            max={18}
            step={1}
            onChange={(v) => setPrefs({ aiMiniFontSize: v })}
          />
          <SliderRow
            title="BG blur"
            description="Panel backdrop softness"
            value={p.aiMiniBgBlur}
            min={0}
            max={20}
            step={1}
            onChange={(v) => setPrefs({ aiMiniBgBlur: v })}
          />
          <SliderRow
            title="BG dim"
            description="Dark overlay strength"
            value={p.aiMiniBgDim}
            min={0}
            max={90}
            step={5}
            onChange={(v) => setPrefs({ aiMiniBgDim: v })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 px-5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium text-foreground">Background style</span>
                <span className="text-[10.5px] leading-relaxed text-muted-foreground">Composer background fill</span>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground font-mono">
                {p.aiComposerBgStyle}
              </span>
            </div>
            <div className="flex gap-1">
              {(["default", "gradient", "solid"] as const).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setPrefs({ aiComposerBgStyle: style })}
                  className={cn(
                    "flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
                    p.aiComposerBgStyle === style
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {style.charAt(0).toUpperCase() + style.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 px-5 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-medium text-foreground">Background color</span>
                <span className="text-[10.5px] leading-relaxed text-muted-foreground">Used by gradient / solid</span>
              </div>
              <span className="text-[11px] text-muted-foreground font-mono">{p.aiComposerBgColor}</span>
            </div>
            <input
              type="color"
              value={p.aiComposerBgColor}
              onChange={(e) => setPrefs({ aiComposerBgColor: e.target.value })}
              className="h-7 w-full cursor-pointer rounded border border-border/40 bg-transparent p-0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-medium tracking-tight text-muted-foreground">{children}</span>;
}
