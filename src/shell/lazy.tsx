import { Suspense } from "react";
import type * as React from "react";

export function PanelLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex h-full min-h-[90px] items-center justify-center text-[11px] text-muted-foreground">
      {label}
    </div>
  );
}

export function lazyPanel(node: React.ReactNode, label?: string) {
  return <Suspense fallback={<PanelLoading label={label} />}>{node}</Suspense>;
}
