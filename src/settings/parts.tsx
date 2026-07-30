import { type ReactNode } from "react";
import { Input } from "@/components/ui/input";

/* Shared husk v1 settings vocabulary: a section header, group label, a bordered
   "card" row for a control, a styled <select>, and a labelled text field. Used
   across every settings section so they read consistently. */

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-[18px] font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? <p className="text-[12px] text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </span>
  );
}

export function Group({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label ? <Label>{label}</Label> : null}
      {children}
    </div>
  );
}

export function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
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

export function Pick<T extends string | number>({
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

/** A full-width labelled text input in a bordered card (for longer values like
 *  model ids, API keys, URLs). */
export function TextField({
  title,
  description,
  value,
  onChange,
  placeholder,
  type,
}: {
  title: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-[12.5px] font-medium text-foreground">{title}</span>
        {description ? (
          <span className="text-[10.5px] leading-relaxed text-muted-foreground">{description}</span>
        ) : null}
      </div>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 bg-background text-[12px]"
      />
    </div>
  );
}
