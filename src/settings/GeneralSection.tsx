import { type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { usePrefs, setPrefs } from "./preferences";
import type {
  WordWrap,
  EditorCursorStyle,
  TerminalCursorStyle,
  LineNumbers,
  RenderWhitespace,
} from "./preferences";
import { FONT_FAMILIES, type FontFamilyId } from "../styles/fonts";
import { TERMINAL_THEME_PRESETS, type TerminalThemePreset } from "../styles/terminalTheme";

/* husk v1's settings layout: SectionHeader + grouped <Label> + a 2-column grid
   of bordered cards, each a row with a Switch or a select. */

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[18px] font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="text-[12px] text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium tracking-tight text-muted-foreground">{children}</span>;
}

function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-foreground">{title}</span>
        {description ? (
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
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
      <SectionHeader title="General" description="Appearance, editor, and terminal." />

      <div className="flex flex-col gap-2">
        <Label>Appearance</Label>
        <div className="grid grid-cols-2 gap-2">
          <Row title="Theme" description="Light or dark mode.">
            <Pick<"dark" | "light">
              value={p.theme}
              onChange={(theme) => setPrefs({ theme })}
              options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
            />
          </Row>
          <Row title="Color preset" description="Tints the whole app + terminal.">
            <Pick<TerminalThemePreset>
              value={p.terminalTheme}
              onChange={(terminalTheme) => setPrefs({ terminalTheme })}
              options={(Object.keys(TERMINAL_THEME_PRESETS) as TerminalThemePreset[]).map((id) => ({
                value: id,
                label: TERMINAL_THEME_PRESETS[id].name,
              }))}
            />
          </Row>
          <Row title="Font family" description="Terminal + editor monospace.">
            <Pick<FontFamilyId> value={p.fontFamily} onChange={(fontFamily) => setPrefs({ fontFamily })} options={fontOptions} />
          </Row>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Editor</Label>
        <div className="grid grid-cols-2 gap-2">
          <Row title="Vim mode" description="Vim keybindings in the editor.">
            <Switch checked={p.vimMode} onCheckedChange={(v) => setPrefs({ vimMode: v })} />
          </Row>
          <Row title="Cursor blink" description="Animate the caret.">
            <Switch checked={p.editorCursorBlink} onCheckedChange={(v) => setPrefs({ editorCursorBlink: v })} />
          </Row>
          <Row title="Minimap" description="Code overview on the right.">
            <Switch checked={p.editorMinimap} onCheckedChange={(v) => setPrefs({ editorMinimap: v })} />
          </Row>
          <Row title="Sticky scroll" description="Pin the enclosing scope.">
            <Switch checked={p.editorStickyScroll} onCheckedChange={(v) => setPrefs({ editorStickyScroll: v })} />
          </Row>
          <Row title="Font ligatures" description="Render =>, !== etc.">
            <Switch checked={p.editorLigatures} onCheckedChange={(v) => setPrefs({ editorLigatures: v })} />
          </Row>
          <Row title="Bracket colors" description="Colorize matching brackets.">
            <Switch checked={p.editorBracketColors} onCheckedChange={(v) => setPrefs({ editorBracketColors: v })} />
          </Row>
          <Row title="Smooth scrolling" description="Animate editor scrolling.">
            <Switch checked={p.editorSmoothScroll} onCheckedChange={(v) => setPrefs({ editorSmoothScroll: v })} />
          </Row>
          <Row title="Format on paste" description="Auto-format pasted code.">
            <Switch checked={p.editorFormatOnPaste} onCheckedChange={(v) => setPrefs({ editorFormatOnPaste: v })} />
          </Row>
          <Row title="Font size" description="Editor text size.">
            <Pick<number> value={p.editorFontSize} onChange={(editorFontSize) => setPrefs({ editorFontSize })} options={px([11, 12, 13, 14, 16, 18, 20])} />
          </Row>
          <Row title="Tab size" description="Spaces per indent.">
            <Pick<number> value={p.editorTabSize} onChange={(editorTabSize) => setPrefs({ editorTabSize })} options={[2, 4, 8].map((n) => ({ value: n, label: `${n} spaces` }))} />
          </Row>
          <Row title="Word wrap" description="Wrap long lines.">
            <Pick<WordWrap>
              value={p.editorWordWrap}
              onChange={(editorWordWrap) => setPrefs({ editorWordWrap })}
              options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }, { value: "bounded", label: "Bounded" }]}
            />
          </Row>
          <Row title="Line numbers" description="Gutter numbering.">
            <Pick<LineNumbers>
              value={p.editorLineNumbers}
              onChange={(editorLineNumbers) => setPrefs({ editorLineNumbers })}
              options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }, { value: "relative", label: "Relative" }]}
            />
          </Row>
          <Row title="Cursor style" description="Caret shape.">
            <Pick<EditorCursorStyle>
              value={p.editorCursorStyle}
              onChange={(editorCursorStyle) => setPrefs({ editorCursorStyle })}
              options={[{ value: "line", label: "Line" }, { value: "block", label: "Block" }, { value: "underline", label: "Underline" }]}
            />
          </Row>
          <Row title="Whitespace" description="Show whitespace markers.">
            <Pick<RenderWhitespace>
              value={p.editorWhitespace}
              onChange={(editorWhitespace) => setPrefs({ editorWhitespace })}
              options={[{ value: "none", label: "None" }, { value: "boundary", label: "Boundary" }, { value: "all", label: "All" }]}
            />
          </Row>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Explorer</Label>
        <Row title="Show hidden files" description="Include dot-prefixed files & folders in the tree.">
          <Switch checked={p.showHidden} onCheckedChange={(v) => setPrefs({ showHidden: v })} />
        </Row>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Terminal</Label>
        <div className="grid grid-cols-2 gap-2">
          <Row title="Cursor blink" description="Blink the terminal cursor.">
            <Switch checked={p.cursorBlink} onCheckedChange={(v) => setPrefs({ cursorBlink: v })} />
          </Row>
          <Row title="Font size" description="Terminal text size.">
            <Pick<number> value={p.terminalFontSize} onChange={(terminalFontSize) => setPrefs({ terminalFontSize })} options={px([11, 12, 13, 14, 16, 18])} />
          </Row>
          <Row title="Scrollback" description="Lines of history kept.">
            <Pick<number>
              value={p.terminalScrollback}
              onChange={(terminalScrollback) => setPrefs({ terminalScrollback })}
              options={[1000, 5000, 10000, 50000].map((n) => ({ value: n, label: `${n.toLocaleString()} lines` }))}
            />
          </Row>
          <Row title="Cursor style" description="Terminal cursor shape.">
            <Pick<TerminalCursorStyle>
              value={p.terminalCursorStyle}
              onChange={(terminalCursorStyle) => setPrefs({ terminalCursorStyle })}
              options={[{ value: "block", label: "Block" }, { value: "bar", label: "Bar" }, { value: "underline", label: "Underline" }]}
            />
          </Row>
        </div>
      </div>
    </div>
  );
}
