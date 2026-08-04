import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* ── Config-file primitives ───────────────────────────────────────────────
   Each renders one or more `.cfg-line` rows, which get auto-numbered by the
   CSS counter in config-theme.css. */

export function ConfigEditor({ children }: { children: ReactNode }) {
  return <div className="cfg-file">{children}</div>;
}

/**
 * ASCII banner rows. Kept as real file lines so the gutter keeps numbering and
 * the "it's a config file" fiction holds, but the file's 2.2 line-height would
 * shred block art, so these rows opt into a tight one.
 */
export function CfgArt({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((line, i) => (
        <div key={i} className="cfg-line cfg-line--art">
          <span className="cfg-art">
            <span className="cfg-art-hash"># </span>
            {line}
          </span>
        </div>
      ))}
    </>
  );
}

export function CfgComment({ children }: { children: ReactNode }) {
  return (
    <div className="cfg-line">
      <span className="cfg-comment"><span className="cfg-comment-mark"># </span>{children}</span>
    </div>
  );
}

export function CfgBlank() {
  return (
    <div className="cfg-line cfg-blank">
      <span>{"\u00A0"}</span>
    </div>
  );
}

export function CfgSection({ name, array = false }: { name: string; array?: boolean }) {
  return (
    <div className="cfg-line">
      <span className="cfg-punct">{array ? "[[" : "["}</span>
      <span className="cfg-sec">{settingLabel(name)}</span>
      <span className="cfg-punct">{array ? "]]" : "]"}</span>
    </div>
  );
}

function settingLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " · ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function CfgRow({
  name,
  comment,
  children,
}: {
  name?: string;
  comment?: string;
  children: ReactNode;
}) {
  return (
    <div className="cfg-setting">
      {name || comment ? (
        <div className="cfg-setting-copy">
          {name ? <span className="cfg-key">{settingLabel(name)}</span> : null}
          {comment ? <span className="cfg-comment"><span className="cfg-comment-mark"># </span>{comment}</span> : null}
        </div>
      ) : null}
      <div className="cfg-line cfg-kv">
        <span className="cfg-val">{children}</span>
      </div>
    </div>
  );
}

/* ── Value controls ─────────────────────────────────────────────────────── */

export function CfgBool({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={cn("cfg-bool", value && "cfg-bool-on")}
      onClick={() => onChange(!value)}
    >
      {value ? "true" : "false"}
    </button>
  );
}

export function CfgEnum<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <>
      <span className="cfg-punct">&quot;</span>
      <select
        className="cfg-enum"
        value={String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="cfg-punct">&quot;</span>
    </>
  );
}

export function CfgSlider({
  value,
  min,
  max,
  step,
  unit = "",
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <>
      <span className="cfg-num">
        {value}
        {unit}
      </span>
      <input
        type="range"
        className="cfg-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="cfg-hint">
        {min}–{max}
        {unit}
      </span>
    </>
  );
}

export function CfgColor({
  value,
  onChange,
  presets,
}: {
  value: string;
  onChange: (v: string) => void;
  presets?: string[];
}) {
  return (
    <>
      <label className="cfg-swatch" style={{ background: value }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <span className="cfg-punct">&quot;</span>
      <span className="cfg-str">{value}</span>
      <span className="cfg-punct">&quot;</span>
      {presets ? (
        <span className="inline-flex items-center gap-1 ml-1">
          {presets.map((c) => (
            <button
              key={c}
              type="button"
              className="cfg-preset"
              style={{ background: c }}
              title={c}
              onClick={() => onChange(c)}
            />
          ))}
        </span>
      ) : null}
    </>
  );
}

export function CfgText({
  value,
  onChange,
  placeholder,
  secret = false,
  widthCh,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secret?: boolean;
  widthCh?: number;
}) {
  return (
    <>
      <span className="cfg-punct">&quot;</span>
      <input
        type={secret ? "password" : "text"}
        className="cfg-text"
        value={value}
        placeholder={placeholder}
        size={widthCh ?? Math.max(value.length, placeholder?.length ?? 8, 8)}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="cfg-punct">&quot;</span>
    </>
  );
}

export function CfgStr({ children }: { children: ReactNode }) {
  return (
    <>
      <span className="cfg-punct">&quot;</span>
      <span className="cfg-str">{children}</span>
      <span className="cfg-punct">&quot;</span>
    </>
  );
}

export function CfgAct({
  onClick,
  danger = false,
  children,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className={cn("cfg-act", danger && "cfg-act-danger")} onClick={onClick}>
      [ {children} ]
    </button>
  );
}

export function CfgBlock({
  value,
  onChange,
  placeholder,
  rows = 5,
  readOnly = false,
  onClick,
}: {
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
  onClick?: () => void;
}) {
  return (
    <textarea
      className="cfg-block"
      value={value}
      rows={rows}
      readOnly={readOnly}
      placeholder={placeholder}
      onClick={onClick}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
    />
  );
}
