import { expect, it } from "vitest";
import { fitStatusTools } from "./fitStatusTools";

it("shows every item when its actual width fits, without a fixed item cap", () => {
  expect(fitStatusTools([50, 50, 50, 50, 50, 50], 360, 12, [20, 20, 20, 20, 20, 20])).toBe(6);
});
it("reserves space for the actual remaining-count indicator", () => {
  expect(fitStatusTools([80, 100, 90, 60], 225, 12, [20, 20, 20, 20])).toBe(2);
  expect(fitStatusTools([80, 100, 90, 60], 203, 12, [20, 20, 20, 20])).toBe(1);
});
it("uses available space for long labels instead of a fixed count", () => {
  expect(fitStatusTools([260, 40, 40], 300, 12, [20, 20, 20])).toBe(1);
  expect(fitStatusTools([40, 40, 40], 300, 12, [20, 20, 20])).toBe(3);
});
it("handles empty, zero-width and fractional layouts", () => {
  expect(fitStatusTools([], 100, 12, [])).toBe(0);
  expect(fitStatusTools([50], 0, 12, [20])).toBe(0);
  expect(fitStatusTools([40.5, 40.5], 93, 12, [20, 20])).toBe(2);
  expect(fitStatusTools([40.5, 40.5], 92.9, 12, [20, 20])).toBe(1);
});
it("measures count digit growth and preserves item priority", () => {
  expect(fitStatusTools(Array(12).fill(40), 123, 12, Array.from({ length: 12 }, (_, i) => i >= 9 ? 30 : 20))).toBe(1);
  expect(fitStatusTools([200, 10], 80, 12, [20, 20])).toBe(0);
});
