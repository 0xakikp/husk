export type CodexCliModel = { id: string; label: string; description: string };

// ChatGPT-sign-in retirement, effective 2026-08-31. Do not apply these
// replacements to OpenAI API or custom/local model configurations.
// https://learn.chatgpt.com/docs/models#deprecated-codex-models
const RETIRED_SUBSCRIPTION_MODELS: Readonly<Record<string, string>> = {
  "gpt-5.4-mini": "gpt-5.6-luna",
  "gpt-5.4": "gpt-5.6-terra",
};

export function resolveCodexSubscriptionModel(model: string): string {
  return Object.prototype.hasOwnProperty.call(RETIRED_SUBSCRIPTION_MODELS, model) ? RETIRED_SUBSCRIPTION_MODELS[model] : model;
}

/** A CLI cache may outlive a retirement. Hide known retired entries, without
 * pretending that replacement models were discovered for this account. */
export function availableCodexModels(models: readonly CodexCliModel[]): CodexCliModel[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id) || resolveCodexSubscriptionModel(model.id) !== model.id) return false;
    seen.add(model.id); return true;
  });
}

/** Keep the selected value visible even before the CLI refreshes its cache.
 * A saved selection is explicitly labelled, not presented as verified access. */
export function codexModelOptions(models: readonly CodexCliModel[], selected?: string): CodexCliModel[] {
  const options = [
    { id: "codex", label: "Codex default", description: "Use the signed-in CLI's default model." },
    ...availableCodexModels(models).filter((model) => model.id !== "codex"),
  ];
  const current = selected ? resolveCodexSubscriptionModel(selected) : undefined;
  if (current && !options.some((model) => model.id === current)) {
    options.push({ id: current, label: `${current} · saved selection`, description: "Not listed in the local CLI cache; account availability is not yet verified." });
  }
  return options;
}
