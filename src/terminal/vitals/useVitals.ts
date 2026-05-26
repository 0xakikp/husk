import { useEffect, useState } from "react";
import {
  subscribeCommandState,
  getCurrentCommand,
  getCommandStartTime,
  isCommandRunning,
} from "@/ai/terminalContext";

export function useVitals() {
  const [command, setCommand] = useState(getCurrentCommand);
  const [startTime, setStartTime] = useState(getCommandStartTime);
  const [running, setRunning] = useState(isCommandRunning);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const unsub = subscribeCommandState(() => {
      setCommand(getCurrentCommand());
      setStartTime(getCommandStartTime());
      setRunning(isCommandRunning());
    });
    return unsub;
  }, []);

  // Tick every second while a command is running
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((v) => v + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsedMs = running && startTime > 0 ? Date.now() - startTime : 0;

  return { command, running, elapsedMs, tick };
}
