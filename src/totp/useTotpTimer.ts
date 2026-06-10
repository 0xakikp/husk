import { useState, useEffect } from "react";
import { loadAccounts } from "./store";
import { generateCode } from "./totp";

/** Minimum seconds remaining across all TOTP accounts. Updates every second. */
export function useTotpTimer() {
  const accounts = loadAccounts();
  const computeMin = () => {
    let min = 30;
    for (const a of accounts) {
      const gen = generateCode(a);
      if (gen && gen.remaining < min) min = gen.remaining;
    }
    return min;
  };

  const [minRemaining, setMinRemaining] = useState(computeMin);

  useEffect(() => {
    const t = setInterval(() => setMinRemaining(computeMin()), 1000);
    return () => clearInterval(t);
  }, [accounts]);

  return minRemaining;
}
