import { Switch } from "@/components/ui/switch";
import { usePrefs, setPrefs } from "./preferences";
import type {
  WordWrap,
  EditorCursorStyle,
  TerminalCursorStyle,
  LineHighlight,
  LineNumbers,
  RenderWhitespace,
} from "./preferences";
import { FONT_FAMILIES, type FontFamilyId } from "../styles/fonts";
import { TERMINAL_THEME_PRESETS, type TerminalThemePreset } from "../styles/terminalTheme";
import { SectionHeader } from "./components/SectionHeader";
import { SettingRow } from "./components/SettingRow";
import { SettingsGroup } from "./components/SettingsGroup";

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
      className="h-7 min-w-[110px] rounded-md border border-border bg-background px-2 text-[11.5px] text-foreground outline-none focus:border-primary"
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

      <SettingsGroup label="AI">
        <SettingRow
          title="AI enabled"
          description="Toggle all AI features on or off. When disabled, the AI chat, agent traces, and AI shortcuts are hidden."
        >
          <Switch
            checked={p.aiEnabled}
            onCheckedChange={(v) => setPrefs({ aiEnabled: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label="Editor">
        <SettingRow title="Vim mode" description="Enable Vim keybindings in the code editor.">
          <Switch
            checked={p.vimMode}
            onCheckedChange={(v) => setPrefs({ vimMode: v })}
          />
        </SettingRow>
        <SettingRow title="Cursor blink" description="Animate the cursor or keep it solid.">
          <Switch
            checked={p.editorCursorBlink}
            onCheckedChange={(v) => setPrefs({ editorCursorBlink: v })}
          />
        </SettingRow>
        <SettingRow title="Minimap" description="Show a zoomed-out code overview on the right.">
          <Switch
            checked={p.editorMinimap}
            onCheckedChange={(v) => setPrefs({ editorMinimap: v })}
          />
        </SettingRow>
        <SettingRow title="Sticky scroll" description="Pin the current function or class name at the top while scrolling.">
          <Switch
            checked={p.editorStickyScroll}
            onCheckedChange={(v) => setPrefs({ editorStickyScroll: v })}
          />
        </SettingRow>
        <SettingRow title="Font size" description="Code editor text size.">
          <Pick<number>
            value={p.editorFontSize}
            onChange={(editorFontSize) => setPrefs({ editorFontSize })}
            options={px([11, 12, 13, 14, 16, 18, 20])}
          />
        </SettingRow>
        <SettingRow title="Tab size" description="Spaces per indent.">
          <Pick<number>
            value={p.editorTabSize}
            onChange={(editorTabSize) => setPrefs({ editorTabSize })}
            options={[2, 4, 8].map((n) => ({ value: n, label: `${n} spaces` }))}
          />
        </SettingRow>
        <SettingRow title="Word wrap" description="Wrap long lines.">
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
        <SettingRow title="Cursor style" description="Caret shape.">
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
        <SettingRow title="Line highlight" description="Highlight the current editor line.">
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
        <SettingRow title="Line numbers" description="Show line numbers in editor.">
          <Pick<LineNumbers>
            value={p.editorLineNumbers}
            onChange={(editorLineNumbers) => setPrefs({ editorLineNumbers })}
            options={[
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
              { value: "relative", label: "Relative" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Whitespace" description="Render whitespace characters.">
          <Pick<RenderWhitespace>
            value={p.editorWhitespace}
            onChange={(editorWhitespace) => setPrefs({ editorWhitespace })}
            options={[
              { value: "none", label: "None" },
              { value: "boundary", label: "Boundary" },
              { value: "all", label: "All" },
            ]}
          />
        </SettingRow>
        <SettingRow title="Ligatures" description="Enable font ligatures for nicer operators.">
          <Switch
            checked={p.editorLigatures}
            onCheckedChange={(v) => setPrefs({ editorLigatures: v })}
          />
        </SettingRow>
        <SettingRow title="Bracket colors" description="Color matching bracket pairs.">
          <Switch
            checked={p.editorBracketColors}
            onCheckedChange={(v) => setPrefs({ editorBracketColors: v })}
          />
        </SettingRow>
        <SettingRow title="Smooth scroll" description="Animated editor scrolling.">
          <Switch
            checked={p.editorSmoothScroll}
            onCheckedChange={(v) => setPrefs({ editorSmoothScroll: v })}
          />
        </SettingRow>
        <SettingRow title="Format on paste" description="Auto-format code when pasting.">
          <Switch
            checked={p.editorFormatOnPaste}
            onCheckedChange={(v) => setPrefs({ editorFormatOnPaste: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label="Explorer">
        <SettingRow title="Show hidden files" description="Include dot-prefixed files & folders in the tree.">
          <Switch
            checked={p.showHidden}
            onCheckedChange={(v) => setPrefs({ showHidden: v })}
          />
        </SettingRow>
        <SettingRow title="Restore session" description="Remember open terminal tabs and their working directories between launches.">
          <Switch
            checked={p.sessionRestoreEnabled}
            onCheckedChange={(v) => setPrefs({ sessionRestoreEnabled: v })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup label="Terminal">
        <SettingRow title="Cursor blink" description="Blink the terminal cursor.">
          <Switch
            checked={p.cursorBlink}
            onCheckedChange={(v) => setPrefs({ cursorBlink: v })}
          />
        </SettingRow>
        <SettingRow title="Font size" description="Terminal text size.">
          <Pick<number>
            value={p.terminalFontSize}
            onChange={(terminalFontSize) => setPrefs({ terminalFontSize })}
            options={px([11, 12, 13, 14, 16, 18])}
          />
        </SettingRow>
        <SettingRow title="Scrollback" description="Lines of history kept.">
          <Pick<number>
            value={p.terminalScrollback}
            onChange={(terminalScrollback) => setPrefs({ terminalScrollback })}
            options={[1000, 5000, 10000, 50000].map((n) => ({
              value: n,
              label: `${n.toLocaleString()} lines`,
            }))}
          />
        </SettingRow>
        <SettingRow title="Cursor style" description="Terminal cursor shape.">
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
        <SettingRow title="Theme" description="Terminal color preset.">
          <Pick<TerminalThemePreset>
            value={p.terminalTheme}
            onChange={(terminalTheme) => setPrefs({ terminalTheme })}
            options={(Object.keys(TERMINAL_THEME_PRESETS) as TerminalThemePreset[]).map((preset) => ({
              value: preset,
              label: TERMINAL_THEME_PRESETS[preset].name,
            }))}
          />
        </SettingRow>
        <SettingRow title="Font family" description="Monospace font for terminal and editor.">
          <Pick<FontFamilyId>
            value={p.fontFamily}
            onChange={(fontFamily) => setPrefs({ fontFamily })}
            options={fontOptions}
          />
        </SettingRow>
        {p.aiEnabled && (
          <SettingRow
            title="Error assistance"
            description="When a command fails, show a toast with an Explain button that opens the AI assistant with the error context."
          >
            <Switch
              checked={p.terminalAiErrorAssist}
              onCheckedChange={(v) => setPrefs({ terminalAiErrorAssist: v })}
            />
          </SettingRow>
        )}
        <SettingRow
          title="Notes directory"
          description="Where your notes are stored. Leave empty to use ~/.husk/notes/"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={p.notesDirectory}
              onChange={(e) => setPrefs({ notesDirectory: e.target.value })}
              placeholder="~/.husk/notes"
              className="h-7 w-52 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none focus:border-primary"
            />
            {p.notesDirectory && (
              <button
                type="button"
                onClick={() => setPrefs({ notesDirectory: "" })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Reset
              </button>
            )}
          </div>
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
