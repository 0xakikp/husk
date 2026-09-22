import { afterEach, expect, it, vi } from "vitest";
import { closeSavedFixes, getSavedFixesView, openSavedFixes, subscribeSavedFixesView } from "./savedFixesView";

afterEach(() => { closeSavedFixes(1); closeSavedFixes(2); });

it("opens only the requested leaf with a stable snapshot until navigation changes", () => {
  expect(getSavedFixesView(1)).toBeNull();
  openSavedFixes(1);
  const request = getSavedFixesView(1);
  expect(request).toMatchObject({ leafId: 1 });
  expect(getSavedFixesView(1)).toBe(request);
  expect(getSavedFixesView(2)).toBeNull();
  openSavedFixes(2);
  expect(getSavedFixesView(1)).toBeNull();
  expect(getSavedFixesView(2)).toMatchObject({ leafId: 2 });
});

it("does not let stale cleanup close a more recent library request", () => {
  openSavedFixes(1); const old = getSavedFixesView(1)!;
  openSavedFixes(1); const latest = getSavedFixesView(1)!;
  closeSavedFixes(1, old.id); expect(getSavedFixesView(1)).toBe(latest);
  closeSavedFixes(2, latest.id); expect(getSavedFixesView(1)).toBe(latest);
  closeSavedFixes(1, latest.id); expect(getSavedFixesView(1)).toBeNull();
});

it("notifies only actual navigation changes and releases listeners", () => {
  const listener = vi.fn(); const unsubscribe = subscribeSavedFixesView(listener);
  closeSavedFixes(1); expect(listener).not.toHaveBeenCalled();
  openSavedFixes(1); expect(listener).toHaveBeenCalledTimes(1);
  closeSavedFixes(2); expect(listener).toHaveBeenCalledTimes(1);
  closeSavedFixes(1); expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe(); openSavedFixes(1); expect(listener).toHaveBeenCalledTimes(2);
});

it.each([-1, NaN, Infinity, 1.5])("ignores invalid leaf IDs: %s", (leafId) => {
  openSavedFixes(leafId); expect(getSavedFixesView(leafId)).toBeNull();
});
