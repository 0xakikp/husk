import { createContext, useContext, useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export const SettingsFieldContext = createContext<{ label: string; labelId: string; descriptionId?: string; errorId?: string } | null>(null);
function useField() {
  const field = useContext(SettingsFieldContext);
  return {
    "aria-labelledby": field?.labelId,
    "aria-describedby": [field?.descriptionId, field?.errorId].filter(Boolean).join(" ") || undefined,
    "aria-invalid": field?.errorId ? true : undefined,
  };
}

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
    <section className="cfg-section" aria-label={settingLabel(name)}>
      <div className="cfg-line">
        <span className="cfg-punct">{array ? "[[" : "["}</span>
        <span className="cfg-sec">{settingLabel(name)}</span>
        <span className="cfg-punct">{array ? "]]" : "]"}</span>
      </div>
    </section>
  );
}

export function settingLabel(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " · ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

export function CfgRow({
  name,
  comment,
  children,
  searchId,
  error,
}: {
  name?: string;
  comment?: string;
  children: ReactNode;
  searchId?: string;
  error?: string;
}) {
  const id = useId();
  const label = name ? settingLabel(name) : comment ?? "Setting";
  return (
    <SettingsFieldContext.Provider value={name || comment ? { label, labelId: `${id}-label`, descriptionId: name && comment ? `${id}-hint` : undefined, errorId: error ? `${id}-error` : undefined } : null}>
    <div className="cfg-setting" data-setting-key={searchId ?? name} tabIndex={-1}>
      {name || comment ? (
        <div className="cfg-setting-copy">
          {name ? <span id={`${id}-label`} className="cfg-key">{label}</span> : null}
          {comment ? <span id={`${id}-${name ? "hint" : "label"}`} className="cfg-comment"><span className="cfg-comment-mark"># </span>{comment}</span> : null}
          {error && <span id={`${id}-error`} className="settings-field-error" role="alert">{error}</span>}
        </div>
      ) : null}
      <div className="cfg-line cfg-kv">
        <span className="cfg-val">{children}</span>
      </div>
    </div>
    </SettingsFieldContext.Provider>
  );
}

/* ── Value controls ─────────────────────────────────────────────────────── */

export function CfgBool({ value, onChange, disabled = false }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const field = useField();
  return (
    <button
      type="button"
      {...field} role="switch" aria-checked={value} disabled={disabled}
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
  const field = useField();
  return (
    <>
      <span className="cfg-punct">&quot;</span>
      <select
        {...field}
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
  const field = useField();
  return (
    <>
      <span className="cfg-num">
        {value}
        {unit}
      </span>
      <input
        type="range"
        {...field} aria-valuetext={`${value}${unit}`}
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
  const field = useField();
  const label = useContext(SettingsFieldContext)?.label ?? "Color";
  return (
    <>
      <label className="cfg-swatch" style={{ background: value }}>
        <input {...field} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
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
              aria-label={`${label}: ${c}`} aria-pressed={value.toLowerCase() === c.toLowerCase()}
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
  const field = useField();
  return (
    <>
      <span className="cfg-punct">&quot;</span>
      <input
        {...field}
        type={secret ? "password" : "text"}
        className="cfg-text"
        value={value}
        placeholder={placeholder}
        size={Math.min(36, widthCh ?? Math.max(value.length, placeholder?.length ?? 8, 8))}
        autoComplete={secret ? "off" : undefined}
        spellCheck={secret ? false : undefined}
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
  disabled = false,
}: {
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button type="button" disabled={disabled} className={cn("cfg-act", danger && "cfg-act-danger")} onClick={onClick}>
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
  const field = useField();
  return (
    <textarea
      {...field}
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
