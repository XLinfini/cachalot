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
      ...(["glm-layout", "formula-chat", "vision-llm"].includes(model.formulaOcr)
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

export const chatModels = (provider: Pick<Provider, "purpose" | "modelId" | "addedModels">) =>
  provider.purpose === "ocr"
    ? []
    : addedModels(provider).filter(
        (model) => !model.formulaOcr || model.formulaOcr === "vision-llm",
      );
export const ocrModels = (provider: Pick<Provider, "modelId" | "addedModels">) =>
  addedModels(provider).filter((model) => !!model.formulaOcr);
export const hasChatModel = (provider: Provider, modelId: string) =>
  chatModels(provider).some((model) => model.id === modelId);

/** Legacy GLM providers predate the explicit purpose setting. Classify only
 * providers with no chat models as OCR; mixed providers keep their chat role. */
export function providerPurpose(
  provider: Pick<Provider, "purpose" | "modelId" | "addedModels">,
): "llm" | "ocr" {
  if (provider.purpose) return provider.purpose;
  const models = addedModels(provider);
  return models.length &&
    models.every(
      (model) => model.formulaOcr === "glm-layout" || model.formulaOcr === "formula-chat",
    )
    ? "ocr"
    : "llm";
}
