import { useSyncExternalStore } from "react";

export type ToastVariant = "info" | "success" | "warning" | "error";
export type ToastAction = { label: string; onClick: () => void };
export type Toast = {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  duration?: number;
  action?: ToastAction;
  actions?: ToastAction[];
  createdAt: number;
};

let toasts: Toast[] = [];
const subscribers = new Set<() => void>();
let idCounter = 0;

function emit() {
  for (const fn of subscribers) fn();
}

export function toast(opts: Omit<Toast, "id" | "createdAt">): string {
  const id = `toast-${++idCounter}`;
  toasts = [...toasts, { ...opts, id, createdAt: Date.now() }];
  emit();
  const duration = opts.duration ?? 4000;
  if (duration > 0) window.setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => toasts,
  );
}
