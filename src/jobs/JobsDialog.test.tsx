// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  bgList: vi.fn(async () => [{ handle: 1, command: "long job", cwd: null, started_at_ms: 1, exited: false, exit_code: null }]),
  bgLogs: vi.fn<(_handle: number, _offset: number) => Promise<{ bytes: string; next_offset: number; dropped: number; exited: boolean; exit_code: null }>>(),
}));
vi.mock("./client", () => ({
  bgList: calls.bgList,
  bgLogs: calls.bgLogs,
  bgSpawn: vi.fn(),
  bgKill: vi.fn(),
  bgRemove: vi.fn(),
}));
vi.mock("../components/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => createElement("div", null, children) }));

import { JobsDialog } from "./JobsDialog";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  calls.bgList.mockClear();
  calls.bgLogs.mockReset();
});

it("serializes log polling and appends each offset exactly once", async () => {
  let finishFirst!: (value: { bytes: string; next_offset: number; dropped: number; exited: boolean; exit_code: null }) => void;
  calls.bgLogs
    .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
    .mockResolvedValue({ bytes: "second", next_offset: 11, dropped: 0, exited: false, exit_code: null });

  await act(async () => root.render(createElement(JobsDialog, { onClose: vi.fn() })));
  await act(async () => host.querySelector<HTMLButtonElement>(".jobs-pick")!.click());
  expect(calls.bgLogs).toHaveBeenCalledExactlyOnceWith(1, 0);

  // A stalled native response must not launch another request for the same
  // offset just because several one-second intervals have elapsed.
  await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
  expect(calls.bgLogs).toHaveBeenCalledTimes(1);

  await act(async () => finishFirst({ bytes: "first ", next_offset: 6, dropped: 0, exited: false, exit_code: null }));
  expect(host.querySelector(".jobs-log")?.textContent).toBe("first ");
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(calls.bgLogs).toHaveBeenNthCalledWith(2, 1, 6);
  expect(host.querySelector(".jobs-log")?.textContent).toBe("first second");
});

it("marks output omitted when the native ring skipped bytes before the requested offset", async () => {
  calls.bgLogs.mockResolvedValue({ bytes: "recent", next_offset: 20, dropped: 14, exited: false, exit_code: null });
  await act(async () => root.render(createElement(JobsDialog, { onClose: vi.fn() })));
  await act(async () => host.querySelector<HTMLButtonElement>(".jobs-pick")!.click());
  expect(host.querySelector(".jobs-log-note")?.textContent).toContain("older output was omitted");
  expect(host.querySelector(".jobs-log")?.textContent).toBe("recent");
});

it("does not stack job-list requests while a native response is stalled", async () => {
  let finishList!: (value: Awaited<ReturnType<typeof calls.bgList>>) => void;
  calls.bgList.mockImplementationOnce(() => new Promise(resolve => { finishList = resolve; }));
  await act(async () => root.render(createElement(JobsDialog, { onClose: vi.fn() })));
  expect(calls.bgList).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(calls.bgList).toHaveBeenCalledTimes(1);
  await act(async () => finishList([{ handle: 1, command: "long job", cwd: null, started_at_ms: 1, exited: false, exit_code: null }]));
  expect(host.querySelector(".jobs-pick")).not.toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
  expect(calls.bgList).toHaveBeenCalledTimes(2);
});
