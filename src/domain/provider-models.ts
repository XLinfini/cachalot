import type { ModelInfo, ModelSelection, Provider } from "./records";

export function normalizeModels(value: unknown): ModelInfo[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, ModelInfo>();
  for (const model of value) {
    if (typeof model?.id !== "string" || !model.id.trim()) continue;
    const id = model.id.trim();
    unique.set(id, {
      id,
      ...(typeof model.enabled === "boolean" ? { enabled: model.enabled } : {}),
      ...(typeof model.ownedBy === "string" ? { ownedBy: model.ownedBy } : {}),
      ...(typeof model.formulaOcr === "string" && /^[a-z][a-z0-9-]*$/.test(model.formulaOcr)
        ? { formulaOcr: model.formulaOcr }
        : {}),
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

export const enabledModels = (
  provider: Pick<Provider, "modelId" | "addedModels"> & Partial<Pick<Provider, "enabled">>,
) => addedModels(provider).filter((model) => model.enabled ?? provider.enabled ?? true);

export const chatModels = (
  provider: Pick<Provider, "purpose" | "modelId" | "addedModels"> &
    Partial<Pick<Provider, "enabled">>,
) =>
  provider.purpose === "ocr"
    ? []
    : enabledModels(provider).filter(
        (model) => !model.formulaOcr || model.formulaOcr === "vision-llm",
      );
export const ocrModels = (
  provider: Pick<Provider, "modelId" | "addedModels"> & Partial<Pick<Provider, "enabled">>,
) => enabledModels(provider).filter((model) => !!model.formulaOcr);
export const hasChatModel = (provider: Provider, modelId: string) =>
  chatModels(provider).some((model) => model.id === modelId);

export function parseModelSelection(stored: string | null): ModelSelection | null {
  try {
    const value = JSON.parse(stored || "null");
    return typeof value?.providerId === "string" && typeof value?.modelId === "string"
      ? { providerId: value.providerId, modelId: value.modelId }
      : null;
  } catch {
    return null;
  }
}

export function isChatSelection(
  providers: Provider[],
  selection: ModelSelection | null,
): selection is ModelSelection {
  return (
    !!selection &&
    providers.some(
      (provider) =>
        provider.id === selection.providerId && hasChatModel(provider, selection.modelId),
    )
  );
}

/** The global default belongs to a provider/model pair. The old provider's
 * default is consulted only during migration; an invalid default stays unset afterwards. */
export function resolveDefaultModel(
  providers: Provider[],
  selection: ModelSelection | null,
  legacyProviderId?: string | null,
): ModelSelection | null {
  if (isChatSelection(providers, selection)) return selection;
  if (legacyProviderId === undefined) return null;
  const available = providers.filter((provider) => chatModels(provider).length);
  const provider = available.find((item) => item.id === legacyProviderId) || available[0];
  if (!provider) return null;
  return {
    providerId: provider.id,
    modelId: hasChatModel(provider, provider.modelId)
      ? provider.modelId
      : chatModels(provider)[0].id,
  };
}

/** Legacy GLM providers predate the explicit purpose setting. Classify only
 * providers with no chat models as OCR; mixed providers keep their chat role. */
export function providerPurpose(
  provider: Pick<Provider, "purpose" | "modelId" | "addedModels">,
): "llm" | "ocr" {
  if (provider.purpose) return provider.purpose;
  const models = addedModels(provider);
  return models.length &&
    models.every((model) => !!model.formulaOcr && model.formulaOcr !== "vision-llm")
    ? "ocr"
    : "llm";
}
