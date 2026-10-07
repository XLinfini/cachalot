import type { ModelInfo, Provider, ProviderInput } from "../domain/records";
import { addedModels, normalizeModels, providerPurpose } from "../domain/provider-models";
import { platform } from "../infrastructure/platform";
import { ocrAdapters } from "../infrastructure/ocr/registry";
import { ocrContext } from "../infrastructure/ocr/transport";
import { message } from "../domain/messages";

export const visionKey = (providerId: string, modelId: string) =>
  `vision:model:${providerId}:${encodeURIComponent(modelId)}`;

/** Model IDs and explicit capabilities are separate from API credentials.
 * Legacy provider-wide vision flags apply only to its configured default model. */
export async function supportsImages(
  provider: Provider,
  modelId = provider.modelId,
): Promise<boolean> {
  if (
    addedModels(provider).some(
      (m) => m.id === modelId && !!m.formulaOcr && ocrAdapters.get(m.formulaOcr)?.requiresVision,
    )
  )
    return true;
  const explicit = await platform.getSetting(visionKey(provider.id, modelId));
  if (explicit !== null && explicit !== "") return explicit === "true";
  const configured =
    (await platform.listProviders()).find((item) => item.id === provider.id) || provider;
  if (modelId !== configured.modelId) return false;
  return (await platform.getSetting(`vision:${provider.id}`)) === "true";
}

async function configuredModels(provider: Provider): Promise<ModelInfo[]> {
  const stored = await platform.getSetting(`addedModels:${provider.id}`);
  if (stored === null) return addedModels(provider);
  try {
    return normalizeModels(JSON.parse(stored));
  } catch {
    return [];
  }
}

export async function listConfiguredProviders(): Promise<Provider[]> {
  return Promise.all(
    (await platform.listProviders()).map(async (provider) => {
      const added = await configuredModels(provider);
      const stored = await platform.getSetting(`providerPurpose:${provider.id}`);
      return {
        ...provider,
        addedModels: added,
        purpose:
          stored === "ocr" || stored === "llm"
            ? stored
            : providerPurpose({ ...provider, addedModels: added }),
      };
    }),
  );
}

export async function saveConfiguredProvider(input: ProviderInput): Promise<Provider> {
  const models =
    input.addedModels === undefined
      ? await configuredModels({ ...input, hasKey: false })
      : normalizeModels(input.addedModels);
  // Retain the legacy row's model field for native transports and the OCR editor.
  // The chat default is stored independently as a global provider/model pair.
  const modelId = input.modelId.trim();
  if (modelId && !models.some((model) => model.id === modelId))
    models.push({
      id: modelId,
      ...(input.purpose === "ocr" ? { formulaOcr: "formula-chat" as const } : {}),
    });
  const previous = (await platform.listProviders()).find((provider) => provider.id === input.id);
  if (previous && previous.modelId !== modelId) {
    // A provider-wide legacy image flag must never move to a different model.
    const legacy = await platform.getSetting(`vision:${input.id}`);
    const explicit = await platform.getSetting(visionKey(input.id, previous.modelId));
    if (legacy !== null && legacy !== "") {
      if (explicit === null || explicit === "")
        await platform.setSetting(visionKey(input.id, previous.modelId), legacy);
      await platform.setSetting(`vision:${input.id}`, "");
    }
  }
  const saved = await platform.saveProvider({ ...input, modelId });
  await platform.setSetting(`addedModels:${saved.id}`, JSON.stringify(models));
  const purpose = input.purpose || providerPurpose({ ...input, modelId, addedModels: models });
  await platform.setSetting(`providerPurpose:${saved.id}`, purpose);
  return { ...saved, addedModels: models, purpose };
}

export async function listModels(
  providerId: string,
  protocol?: ModelInfo["formulaOcr"],
): Promise<ModelInfo[]> {
  // Available models exist only in the settings drawer's temporary UI state.
  if (protocol === undefined) {
    const provider = (await listConfiguredProviders()).find((p) => p.id === providerId);
    protocol = provider && addedModels(provider).find((m) => m.id === provider.modelId)?.formulaOcr;
  }
  if (protocol) {
    const adapter = ocrAdapters.require(protocol);
    const provider = (await listConfiguredProviders()).find((p) => p.id === providerId);
    if (!provider) throw new Error(message("providerNotFound"));
    const context = ocrContext(provider);
    const models = adapter.listModels
      ? await adapter.listModels(context)
      : await context.transport.models();
    return models.map((model) => ({ ...model, formulaOcr: protocol }));
  }
  return platform.listModels(providerId);
}
