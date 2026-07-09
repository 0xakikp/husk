import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon } from "@hugeicons/core-free-icons";

export function DetailPanelShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[12px] font-semibold text-foreground">{title}</span>
          <span className="truncate text-[10px] text-muted-foreground">{subtitle}</span>
        </div>
        <div className="flex items-center gap-1">
          <CopyButton text={title} />
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
    </div>
  );
}

export function DetailTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 gap-1 border-b border-border/50 px-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] font-medium transition-colors",
            active === t.id
              ? "border-b-2 border-primary text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const copy = () => {
    void navigator.clipboard.writeText(text);
  };
  return (
    <button
      type="button"
      aria-label="Copy name"
      title="Copy name"
      onClick={copy}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.75} />
    </button>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function KVGrid({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map((r) => (
        <div key={r.label} className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
          <div className="text-[10px] text-muted-foreground">{r.label}</div>
          <div className="truncate text-[11.5px] font-medium text-foreground">{r.value || "-"}</div>
        </div>
      ))}
    </div>
  );
}

export function YamlView({ yaml }: { yaml: string }) {
  return (
    <pre className="h-full overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {yaml}
    </pre>
  );
}

export function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "warning" | "error" }) {
  const classes = {
    default: "bg-muted/40 text-foreground",
    success: "bg-emerald-500/15 text-emerald-400",
    warning: "bg-amber-500/15 text-amber-400",
    error: "bg-rose-500/15 text-rose-400",
  };
  return (
    <span className={cn("rounded px-1.5 py-0 text-[10px] font-semibold", classes[variant])}>
      {children}
    </span>
  );
}

export function Labels({ labels }: { labels: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(labels).length === 0 ? (
        <span className="text-[11px] text-muted-foreground">No labels</span>
      ) : (
        Object.entries(labels).map(([k, v]) => (
          <span
            key={k}
            className="rounded-md border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] text-foreground"
          >
            {k}: {v}
          </span>
        ))
      )}
    </div>
  );
}

export function ResourceList({ items, empty }: { items: { label: string; sub?: string }[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      {items.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">{empty}</span>
      ) : (
        items.map((item, i) => (
          <div key={i} className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
            <div className="text-[11.5px] text-foreground">{item.label}</div>
            {item.sub && <div className="text-[10px] text-muted-foreground">{item.sub}</div>}
          </div>
        ))
      )}
    </div>
  );
}
