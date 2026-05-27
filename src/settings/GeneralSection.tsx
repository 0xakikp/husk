import { type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { usePrefs, setPrefs } from "./preferences";
import type {
  WordWrap,
  EditorCursorStyle,
  TerminalCursorStyle,
  LineHighlight,
} from "./preferences";
import { FONT_FAMILIES, type FontFamilyId } from "../styles/fonts";
import { TERMINAL_THEME_PRESETS, type TerminalThemePreset } from "../styles/terminalTheme";
import { SectionHeader } from "./components/SectionHeader";
import { SettingRow } from "./components/SettingRow";

/* husk v1 settings vocabulary: every control sits inside a bordered card
   (rounded border border-border/40 bg-muted/20). SectionHeader labels the
   group, Label gives a subsection title, and SettingRow is the row. */

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium tracking-tight text-muted-foreground">{children}</span>;
}

function Pick<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const o = options.find((x) => String(x.value) === e.target.value);
        if (o) onChange(o.value);
      }}
      className="h-7 rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none focus:border-primary"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const px = (a: number[]) => a.map((n) => ({ value: n, label: `${n}px` }));

export function GeneralSection() {
  const p = usePrefs();
  const fontOptions = (Object.keys(FONT_FAMILIES) as FontFamilyId[]).map((id) => ({
    value: id,
    label: FONT_FAMILIES[id].name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="General"
        description="Editor, terminal, and startup."
      />

      <div className="flex flex-col gap-2">
        <SettingRow
          className="rounded border border-border/40 bg-muted/20 py-2"
          title="AI enabled"
          description="Toggle all AI features on or off. When disabled, the AI panel, agent traces, and AI shortcuts are hidden."
        >
          <Switch
            checked={p.aiEnabled}
            onCheckedChange={(v) => setPrefs({ aiEnabled: v })}
          />
        </SettingRow>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Editor</Label>
        <div className="grid grid-cols-2 gap-2">
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Vim mode"
            description="Enable Vim keybindings in the code editor."
          >
            <Switch
              checked={p.vimMode}
              onCheckedChange={(v) => setPrefs({ vimMode: v })}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Cursor blink"
            description="Animate the cursor or keep it solid."
          >
            <Switch
              checked={p.editorCursorBlink}
              onCheckedChange={(v) => setPrefs({ editorCursorBlink: v })}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Minimap"
            description="Show a zoomed-out code overview on the right."
          >
            <Switch
              checked={p.editorMinimap}
              onCheckedChange={(v) => setPrefs({ editorMinimap: v })}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Sticky scroll"
            description="Pin the current function or class name at the top while scrolling."
          >
            <Switch
              checked={p.editorStickyScroll}
              onCheckedChange={(v) => setPrefs({ editorStickyScroll: v })}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Font size"
            description="Code editor text size."
          >
            <Pick<number>
              value={p.editorFontSize}
              onChange={(editorFontSize) => setPrefs({ editorFontSize })}
              options={px([11, 12, 13, 14, 16, 18, 20])}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Tab size"
            description="Spaces per indent."
          >
            <Pick<number>
              value={p.editorTabSize}
              onChange={(editorTabSize) => setPrefs({ editorTabSize })}
              options={[2, 4, 8].map((n) => ({ value: n, label: `${n} spaces` }))}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Word wrap"
            description="Wrap long lines."
          >
            <Pick<WordWrap>
              value={p.editorWordWrap}
              onChange={(editorWordWrap) => setPrefs({ editorWordWrap })}
              options={[
                { value: "off", label: "Off" },
                { value: "on", label: "On" },
                { value: "bounded", label: "Bounded" },
              ]}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Cursor style"
            description="Caret shape."
          >
            <Pick<EditorCursorStyle>
              value={p.editorCursorStyle}
              onChange={(editorCursorStyle) => setPrefs({ editorCursorStyle })}
              options={[
                { value: "line", label: "Line" },
                { value: "block", label: "Block" },
                { value: "underline", label: "Underline" },
              ]}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Line highlight"
            description="Highlight the current editor line."
          >
            <Pick<LineHighlight>
              value={p.editorLineHighlight}
              onChange={(editorLineHighlight) => setPrefs({ editorLineHighlight })}
              options={[
                { value: "none", label: "None" },
                { value: "line", label: "Line" },
                { value: "gutter", label: "Gutter" },
                { value: "all", label: "All" },
              ]}
            />
          </SettingRow>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Explorer</Label>
        <div className="grid grid-cols-2 gap-2">
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Show hidden files"
            description="Include dot-prefixed files & folders in the tree."
          >
            <Switch
              checked={p.showHidden}
              onCheckedChange={(v) => setPrefs({ showHidden: v })}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Restore session"
            description="Remember open terminal tabs and their working directories between launches."
          >
            <Switch
              checked={p.sessionRestoreEnabled}
              onCheckedChange={(v) => setPrefs({ sessionRestoreEnabled: v })}
            />
          </SettingRow>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Terminal</Label>
        <div className="grid grid-cols-2 gap-2">
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Cursor blink"
            description="Blink the terminal cursor."
          >
            <Switch
              checked={p.cursorBlink}
              onCheckedChange={(v) => setPrefs({ cursorBlink: v })}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Font size"
            description="Terminal text size."
          >
            <Pick<number>
              value={p.terminalFontSize}
              onChange={(terminalFontSize) => setPrefs({ terminalFontSize })}
              options={px([11, 12, 13, 14, 16, 18])}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Scrollback"
            description="Lines of history kept."
          >
            <Pick<number>
              value={p.terminalScrollback}
              onChange={(terminalScrollback) => setPrefs({ terminalScrollback })}
              options={[1000, 5000, 10000, 50000].map((n) => ({
                value: n,
                label: `${n.toLocaleString()} lines`,
              }))}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Cursor style"
            description="Terminal cursor shape."
          >
            <Pick<TerminalCursorStyle>
              value={p.terminalCursorStyle}
              onChange={(terminalCursorStyle) => setPrefs({ terminalCursorStyle })}
              options={[
                { value: "block", label: "Block" },
                { value: "bar", label: "Bar" },
                { value: "underline", label: "Underline" },
              ]}
            />
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Theme"
            description="Terminal color preset."
          >
            <select
              value={p.terminalTheme}
              onChange={(e) => setPrefs({ terminalTheme: e.target.value as TerminalThemePreset })}
              className="h-8 appearance-none rounded-none border border-border bg-background px-2.5 pr-6 text-[12px] text-primary outline-none focus:border-primary"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 8px center",
              }}
            >
              {(Object.keys(TERMINAL_THEME_PRESETS) as TerminalThemePreset[]).map((preset) => (
                <option key={preset} value={preset}>
                  {TERMINAL_THEME_PRESETS[preset].name}
                </option>
              ))}
            </select>
          </SettingRow>
          <SettingRow
            className="rounded border border-border/40 bg-muted/20 py-2"
            title="Font family"
            description="Monospace font for terminal and editor."
          >
            <select
              value={p.fontFamily}
              onChange={(e) => setPrefs({ fontFamily: e.target.value as FontFamilyId })}
              className="h-8 appearance-none rounded-none border border-border bg-background px-2.5 pr-6 text-[12px] text-primary outline-none focus:border-primary"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 8px center",
              }}
            >
              {fontOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </SettingRow>
          {p.aiEnabled && (
            <SettingRow
              className="rounded border border-border/40 bg-muted/20 py-2"
              title="Error assistance"
              description="When a command fails, show a toast with an Explain button that opens the AI assistant with the error context."
            >
              <Switch
                checked={p.terminalAiErrorAssist}
                onCheckedChange={(v) => setPrefs({ terminalAiErrorAssist: v })}
              />
            </SettingRow>
          )}
        </div>
      </div>
    </div>
  );
}
