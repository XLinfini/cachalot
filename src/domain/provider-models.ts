import type { ModelInfo, Provider } from "./records";

export function normalizeModels(value: unknown): ModelInfo[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, ModelInfo>();
  for (const model of value) {
    if (typeof model?.id !== "string" || !model.id.trim()) continue;
    const id = model.id.trim();
    unique.set(id, {
      id,
      ...(typeof model.ownedBy === "string" ? { ownedBy: model.ownedBy } : {}),
    });
  }
  return [...unique.values()];
}

/** Only the old configured default counts as added during migration. A fetched
 * catalogue or a previous chat choice never adds models. An empty list stays empty.
 */
export function addedModels(provider: Pick<Provider, "modelId" | "addedModels">): ModelInfo[] {
  return provider.addedModels === undefined
    ? normalizeModels([{ id: provider.modelId }])
    : normalizeModels(provider.addedModels);
}

export function hasAddedModel(provider: Provider, modelId: string): boolean {
  return addedModels(provider).some((model) => model.id === modelId);
}
