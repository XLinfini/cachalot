import type { ModelInfo, Provider, ProviderInput } from "../domain/records";
import { addedModels, normalizeModels } from "../domain/provider-models";
import { platform } from "../infrastructure/platform";

export const visionKey = (providerId: string, modelId: string) =>
  `vision:model:${providerId}:${encodeURIComponent(modelId)}`;

/** Model IDs and explicit capabilities are separate from API credentials.
 * Legacy provider-wide vision flags apply only to its configured default model. */
export async function supportsImages(
  provider: Provider,
  modelId = provider.modelId,
): Promise<boolean> {
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
    (await platform.listProviders()).map(async (provider) => ({
      ...provider,
      addedModels: await configuredModels(provider),
    })),
  );
}

export async function saveConfiguredProvider(input: ProviderInput): Promise<Provider> {
  const models =
    input.addedModels === undefined
      ? await configuredModels({ ...input, hasKey: false })
      : normalizeModels(input.addedModels);
  // Saving a manually entered default ID explicitly adds it to the user's list.
  const modelId = input.modelId.trim();
  if (modelId && !models.some((model) => model.id === modelId)) models.push({ id: modelId });
  const saved = await platform.saveProvider({ ...input, modelId });
  await platform.setSetting(`addedModels:${saved.id}`, JSON.stringify(models));
  return { ...saved, addedModels: models };
}

export async function listModels(providerId: string): Promise<ModelInfo[]> {
  // Available models exist only in the settings drawer's temporary UI state.
  return platform.listModels(providerId);
}
