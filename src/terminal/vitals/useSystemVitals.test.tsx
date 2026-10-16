// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => native);
import { useSystemVitals } from "./useSystemVitals";
let root: Root, host: HTMLDivElement;
const sample = { cpu_percent: 10, mem_used_mb: 1000, mem_total_mb: 2000, mem_percent: 50, load_1: 1 };
function View({ enabled }: { enabled: boolean }) { const value = useSystemVitals(enabled); return <output>{value?.cpu_percent ?? "unavailable"}</output>; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); native.invoke.mockReset().mockResolvedValue(sample);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render(enabled: boolean) { await act(async () => root.render(<View enabled={enabled} />)); }
it("does not poll until requested and stops when details close", async () => {
  await render(false); await act(async () => vi.advanceTimersByTimeAsync(9000)); expect(native.invoke).not.toHaveBeenCalled();
  await render(true); expect(native.invoke).toHaveBeenCalledExactlyOnceWith("system_vitals");
  await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(native.invoke).toHaveBeenCalledTimes(2);
  await render(false); await act(async () => vi.advanceTimersByTimeAsync(9000)); expect(native.invoke).toHaveBeenCalledTimes(2);
});
it("does not pile up requests or accept late results after details close", async () => {
  let finish!: (value: typeof sample) => void;
  native.invoke.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await render(true); await act(async () => vi.advanceTimersByTimeAsync(12000)); expect(native.invoke).toHaveBeenCalledOnce();
  await render(false); await act(async () => finish(sample)); expect(host.textContent).toBe("unavailable");
});
it("does not keep stale metrics after a failed refresh", async () => {
  await render(true); expect(host.textContent).toBe("10"); native.invoke.mockRejectedValue(new Error("unavailable"));
  await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(host.textContent).toBe("unavailable");
});
