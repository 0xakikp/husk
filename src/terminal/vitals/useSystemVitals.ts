import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type SystemVitals = {
  cpu_percent: number;
  mem_used_mb: number;
  mem_total_mb: number;
  mem_percent: number;
  load_1: number;
};

export function useSystemVitals() {
  const [vitals, setVitals] = useState<SystemVitals | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const v = await invoke<SystemVitals>("system_vitals");
        if (!cancelled) setVitals(v);
      } catch {
        // ignore on platforms where the command isn't available
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return vitals;
}
