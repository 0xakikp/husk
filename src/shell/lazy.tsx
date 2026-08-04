import { Suspense } from "react";
import type * as React from "react";
import { Spinner } from "@/components/Spinner";

export function PanelLoading({ label = "Loading" }: { label?: string }) {
  /* Was the bare label, so opening Kubernetes showed the word "Kubernetes"
     centred in an empty pane — indistinguishable from a panel that loaded and
     had nothing in it. */
  return (
    <div className="flex h-full min-h-[90px] items-center justify-center gap-2 text-[11px] text-muted-foreground">
      <Spinner size={12} />
      <span>{label}…</span>
    </div>
  );
}

export function lazyPanel(node: React.ReactNode, label?: string) {
  return <Suspense fallback={<PanelLoading label={label} />}>{node}</Suspense>;
}
