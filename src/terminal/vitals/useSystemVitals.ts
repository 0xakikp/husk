import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type SystemVitals = {
  cpu_percent: number;
  mem_used_mb: number;
  mem_total_mb: number;
  mem_percent: number;
  load_1: number;
};

export function useSystemVitals(enabled = true) {
  const [vitals, setVitals] = useState<SystemVitals | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let pending = false;
    setVitals(null);
    const tick = async () => {
      if (pending) return;
      pending = true;
      try {
        const v = await invoke<SystemVitals>("system_vitals");
        if (!cancelled) setVitals(v);
      } catch {
        if (!cancelled) setVitals(null);
      } finally {
        pending = false;
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [enabled]);

  return vitals;
}
