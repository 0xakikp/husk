import { expect, it } from "vitest";
import { availableCodexModels, codexModelOptions, resolveCodexSubscriptionModel } from "./codexModels";

it.each([
  ["gpt-5.4-mini", "gpt-5.6-luna"], ["gpt-5.4", "gpt-5.6-terra"],
])("migrates retired ChatGPT subscription model %s to its documented replacement", (model, replacement) => {
  expect(resolveCodexSubscriptionModel(model)).toBe(replacement);
});

it.each(["codex", "gpt-5.6-luna", "gpt-5.5", "future-model", "custom/gpt-5.4-mini", "toString"])("preserves other explicit model selections: %s", (model) => {
  expect(resolveCodexSubscriptionModel(model)).toBe(model);
});

it("filters stale cache entries without inventing discovered replacement models", () => {
  const models = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5", "gpt-5.5"].map((id) => ({ id, label: id, description: "Cached model" }));
  expect(availableCodexModels(models).map((model) => model.id)).toEqual(["gpt-5.5"]);
  expect(models).toHaveLength(4);
});

it("keeps the default escape hatch and labels a saved selection absent from the cache", () => {
  const options = codexModelOptions([], "gpt-5.4-mini");
  expect(options.map((model) => model.id)).toEqual(["codex", "gpt-5.6-luna"]);
  expect(options[1].label).toContain("saved selection");
  expect(options[1].description).toContain("not yet verified");
});

it("deduplicates default and selected entries when the cache already contains them", () => {
  const models = ["codex", "gpt-5.6-luna"].map((id) => ({ id, label: id, description: "" }));
  expect(codexModelOptions(models, "gpt-5.6-luna")).toHaveLength(2);
});
