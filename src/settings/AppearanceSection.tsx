import { useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { usePrefs, setPrefs } from "./preferences";
import { SectionHeader } from "./components/SectionHeader";
import { SettingRow } from "./components/SettingRow";
import { open } from "@tauri-apps/plugin-dialog";
import { HugeiconsIcon } from "@hugeicons/react";
import { Image02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

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
      <SectionHeader
        title="Appearance"
        description="Customize the app background image and transparency."
      />

      <div className="flex flex-col gap-2">
        <SettingRow
          className="rounded border border-border/40 bg-muted/20 py-2"
          title="Background image"
          description="Show a custom image behind the terminal and editor."
        >
          <Switch
            checked={bg.enabled}
            onCheckedChange={(v) => patchBg({ enabled: v })}
          />
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

        <SettingRow
          className="rounded border border-border/40 bg-muted/20 py-2"
          title="Opacity"
          description={`${bg.opacity}%`}
        >
          <div className="w-32">
            <Slider
              value={[bg.opacity]}
              min={10}
              max={100}
              step={5}
              onValueChange={([v]) => patchBg({ opacity: v })}
            />
          </div>
        </SettingRow>

        <SettingRow
          className="rounded border border-border/40 bg-muted/20 py-2"
          title="Blur"
          description={`${bg.blur}px`}
        >
          <div className="w-32">
            <Slider
              value={[bg.blur]}
              min={0}
              max={20}
              step={1}
              onValueChange={([v]) => patchBg({ blur: v })}
            />
          </div>
        </SettingRow>

        <SettingRow
          className="rounded border border-border/40 bg-muted/20 py-2"
          title="Dim"
          description={`${bg.dim}%`}
        >
          <div className="w-32">
            <Slider
              value={[bg.dim]}
              min={0}
              max={90}
              step={5}
              onValueChange={([v]) => patchBg({ dim: v })}
            />
          </div>
        </SettingRow>
      </div>
    </div>
  );
}
