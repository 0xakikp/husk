import { usePrefs, setPrefs } from "../preferences";
import type {
  WordWrap,
  EditorCursorStyle,
  TerminalCursorStyle,
  LineHighlight,
  LineNumbers,
  RenderWhitespace,
} from "../preferences";
import { FONT_FAMILIES, isFamilyInstalled, type FontFamilyId } from "../../styles/fonts";
import { TERMINAL_THEME_PRESETS, type TerminalThemePreset } from "../../styles/terminalTheme";
import {
  ConfigEditor,
  CfgArt,
  CfgBlank,
  CfgComment,
  CfgEnum,
  CfgBool,
  CfgRow,
  CfgSection,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";
import { useNativeConfigStatus } from "../nativeConfig";

const px = (a: number[]) => a.map((n) => ({ value: n, label: `${n}px` }));

export function GeneralFile() {
  const p = usePrefs();
  const config = useNativeConfigStatus();
  /* Glass TTY VT220 has no bundled faces and no @fontsource package, so the
     option only does anything once it is installed system-wide. Saying that in
     the label beats letting the pick silently render as the next font. */
  const fontOptions = (Object.keys(FONT_FAMILIES) as FontFamilyId[]).map((id) => ({
    value: id,
    label: isFamilyInstalled(id) ? FONT_FAMILIES[id].name : `${FONT_FAMILIES[id].name} (not installed)`,
  }));

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.config} />
      <CfgBlank />

      <CfgSection name="profile" />
      <CfgRow name="name" comment="Optional. Husk AI uses it sparingly in replies. Stored locally; sent only with AI requests when set. Clear the field to remove it.">
        <CfgText
          value={p.userName}
          onChange={(userName) => setPrefs({ userName })}
          placeholder="What should Husk call you?"
          widthCh={28}
        />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="ai" />
      <CfgRow name="enabled" comment="Toggle all AI features. Hides chat, traces, and shortcuts.">
        <CfgBool value={p.aiEnabled} onChange={(v) => setPrefs({ aiEnabled: v })} />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="editor" />
      <CfgRow name="vimMode" comment="Vim keybindings in the code editor.">
        <CfgBool value={p.vimMode} onChange={(v) => setPrefs({ vimMode: v })} />
      </CfgRow>
      <CfgRow name="cursorBlink" comment="Blink the editor caret.">
        <CfgBool value={p.editorCursorBlink} onChange={(v) => setPrefs({ editorCursorBlink: v })} />
      </CfgRow>
      <CfgRow name="minimap" comment="Zoomed-out code overview on the right.">
        <CfgBool value={p.editorMinimap} onChange={(v) => setPrefs({ editorMinimap: v })} />
      </CfgRow>
      <CfgRow name="stickyScroll" comment="Pin the current function/class at the top while scrolling.">
        <CfgBool value={p.editorStickyScroll} onChange={(v) => setPrefs({ editorStickyScroll: v })} />
      </CfgRow>
      <CfgRow name="fontSize" comment="Editor text size, in pixels.">
        <CfgEnum<number>
          value={p.editorFontSize}
          onChange={(editorFontSize) => setPrefs({ editorFontSize })}
          options={px([11, 12, 13, 14, 16, 18, 20])}
        />
      </CfgRow>
      <CfgRow name="tabSize" comment="Spaces a Tab key inserts and displays as.">
        <CfgEnum<number>
          value={p.editorTabSize}
          onChange={(editorTabSize) => setPrefs({ editorTabSize })}
          options={[2, 4, 8].map((n) => ({ value: n, label: `${n} spaces` }))}
        />
      </CfgRow>
      <CfgRow name="wordWrap" comment="Where long lines wrap instead of scrolling sideways.">
        <CfgEnum<WordWrap>
          value={p.editorWordWrap}
          onChange={(editorWordWrap) => setPrefs({ editorWordWrap })}
          options={[
            { value: "off", label: "Off" },
            { value: "on", label: "On" },
            { value: "bounded", label: "Bounded" },
          ]}
        />
      </CfgRow>
      <CfgRow name="lineNumbers" comment="Gutter numbering: off, absolute, or relative to the caret (handy with vim).">
        <CfgEnum<LineNumbers>
          value={p.editorLineNumbers}
          onChange={(editorLineNumbers) => setPrefs({ editorLineNumbers })}
          options={[
            { value: "on", label: "On" },
            { value: "off", label: "Off" },
            { value: "relative", label: "Relative" },
          ]}
        />
      </CfgRow>
      <details className="settings-advanced-group">
        <summary><span>Advanced editor</span><small>Caret, highlighting, whitespace, and formatting</small></summary>
        <div className="settings-advanced-group-content">
          <CfgRow name="cursorStyle" comment="Shape of the editor caret.">
            <CfgEnum<EditorCursorStyle>
              value={p.editorCursorStyle}
              onChange={(editorCursorStyle) => setPrefs({ editorCursorStyle })}
              options={[
                { value: "line", label: "Line" },
                { value: "block", label: "Block" },
                { value: "underline", label: "Underline" },
              ]}
            />
          </CfgRow>
          <CfgRow name="lineHighlight" comment="How the line your caret sits on is marked.">
            <CfgEnum<LineHighlight>
              value={p.editorLineHighlight}
              onChange={(editorLineHighlight) => setPrefs({ editorLineHighlight })}
              options={[
                { value: "none", label: "None" },
                { value: "line", label: "Line" },
                { value: "gutter", label: "Gutter" },
                { value: "all", label: "All" },
              ]}
            />
          </CfgRow>
          <CfgRow name="whitespace" comment="Render spaces and tabs as faint dots.">
            <CfgEnum<RenderWhitespace>
              value={p.editorWhitespace}
              onChange={(editorWhitespace) => setPrefs({ editorWhitespace })}
              options={[
                { value: "none", label: "None" },
                { value: "boundary", label: "Boundary" },
                { value: "all", label: "All" },
              ]}
            />
          </CfgRow>
          <CfgRow name="ligatures" comment="Combine character pairs like != and => into single glyphs. Needs a font that supports them.">
            <CfgBool value={p.editorLigatures} onChange={(v) => setPrefs({ editorLigatures: v })} />
          </CfgRow>
          <CfgRow name="bracketColors" comment="Colour matching bracket pairs so nesting is easier to follow.">
            <CfgBool value={p.editorBracketColors} onChange={(v) => setPrefs({ editorBracketColors: v })} />
          </CfgRow>
          <CfgRow name="smoothScroll" comment="Animate scrolling instead of jumping.">
            <CfgBool value={p.editorSmoothScroll} onChange={(v) => setPrefs({ editorSmoothScroll: v })} />
          </CfgRow>
          <CfgRow name="formatOnPaste" comment="Reindent pasted code to match the surrounding file.">
            <CfgBool value={p.editorFormatOnPaste} onChange={(v) => setPrefs({ editorFormatOnPaste: v })} />
          </CfgRow>
        </div>
      </details>
      <CfgBlank />

      <CfgSection name="explorer" />
      <CfgRow name="showHiddenFiles" comment="Include dot-prefixed files in the tree.">
        <CfgBool value={p.showHidden} onChange={(v) => setPrefs({ showHidden: v })} />
      </CfgRow>
      <CfgRow name="restoreSession" comment="Remember tabs and working directories between launches.">
        <CfgBool value={p.sessionRestoreEnabled} onChange={(v) => setPrefs({ sessionRestoreEnabled: v })} />
      </CfgRow>
      <CfgBlank />

      <CfgSection name="terminal" />
      <CfgRow name="cursorBlink" comment="Blink the terminal cursor.">
        <CfgBool value={p.cursorBlink} onChange={(v) => setPrefs({ cursorBlink: v })} />
      </CfgRow>
      <CfgRow name="fontSize" comment="Terminal text size, in pixels.">
        <CfgEnum<number>
          value={p.terminalFontSize}
          onChange={(terminalFontSize) => setPrefs({ terminalFontSize })}
          options={px([11, 12, 13, 14, 16, 18])}
        />
      </CfgRow>
      <CfgRow name="theme" comment="Terminal colour palette. Applies to output only, not the app chrome.">
        <CfgEnum<TerminalThemePreset>
          value={p.terminalTheme}
          onChange={(terminalTheme) => setPrefs({ terminalTheme })}
          options={(Object.keys(TERMINAL_THEME_PRESETS) as TerminalThemePreset[]).map((preset) => ({
            value: preset,
            label: TERMINAL_THEME_PRESETS[preset].name,
          }))}
        />
      </CfgRow>
      <CfgRow name="fontFamily" comment="Terminal typeface. Ligature support varies by font.">
        <CfgEnum<FontFamilyId>
          value={p.fontFamily}
          onChange={(fontFamily) => setPrefs({ fontFamily })}
          options={fontOptions}
        />
      </CfgRow>
      {p.aiEnabled ? (
        <CfgRow name="errorAssist" comment="Show an Explain toast when a command fails.">
          <CfgBool
            value={p.terminalAiErrorAssist}
            onChange={(v) => setPrefs({ terminalAiErrorAssist: v })}
          />
        </CfgRow>
      ) : null}
      <details className="settings-advanced-group">
        <summary><span>Advanced terminal</span><small>Font weight, scrollback, and cursor styling</small></summary>
        <div className="settings-advanced-group-content">
          <CfgRow name="boldFont" comment="Draw all terminal text bold. Bold output goes heavier still, so it stays distinct.">
            <CfgBool
              value={p.terminalBoldFont}
              onChange={(terminalBoldFont) => setPrefs({ terminalBoldFont })}
            />
          </CfgRow>
          <CfgRow name="scrollback" comment="Lines of history kept.">
            <CfgEnum<number>
              value={p.terminalScrollback}
              onChange={(terminalScrollback) => setPrefs({ terminalScrollback })}
              options={[1000, 5000, 10000, 50000].map((n) => ({
                value: n,
                label: `${n.toLocaleString()} lines`,
              }))}
            />
          </CfgRow>
          <CfgRow name="cursorStyle" comment="Shape of the terminal cursor.">
            <CfgEnum<TerminalCursorStyle>
              value={p.terminalCursorStyle}
              onChange={(terminalCursorStyle) => setPrefs({ terminalCursorStyle })}
              options={[
                { value: "block", label: "Block" },
                { value: "bar", label: "Bar" },
                { value: "underline", label: "Underline" },
              ]}
            />
          </CfgRow>
        </div>
      </details>
      <CfgRow name="notesDirectory" comment="Leave empty to use ~/.husk/notes/">
        <CfgText
          value={p.notesDirectory}
          onChange={(notesDirectory) => setPrefs({ notesDirectory })}
          placeholder="~/.husk/notes"
        />
      </CfgRow>
      <CfgBlank />
      <CfgComment>
        {config.ready && config.path
          ? `saved automatically to ${config.path}`
          : config.error
            ? `settings are using the previous local copy: ${config.error}`
            : "preparing ~/.husk/config.toml…"}
      </CfgComment>
    </ConfigEditor>
  );
}
