import type {
  AvailableModel,
  ModelInfo,
  ModelSelection,
  Provider,
  ProviderInput,
} from "../domain/records";
import {
  addedModels,
  enabledModels,
  chatModels,
  normalizeModels,
  providerPurpose,
} from "../domain/provider-models";
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
      const original = await configuredModels(provider);
      const added = original.map((model) => ({
        ...model,
        enabled: model.enabled ?? provider.enabled,
      }));
      // Migrate the old provider-wide switch once; transports keep their row enabled.
      if (original.some((model) => model.enabled === undefined) || !provider.enabled) {
        await platform.setSetting(`addedModels:${provider.id}`, JSON.stringify(added));
        if (!provider.enabled)
          await platform.saveProvider({ ...provider, enabled: true, apiKey: "" });
      }
      const stored = await platform.getSetting(`providerPurpose:${provider.id}`);
      return {
        ...provider,
        enabled: true,
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
  const configured = models.map((model) => ({ ...model, enabled: model.enabled ?? input.enabled }));
  const saved = await platform.saveProvider({ ...input, modelId, enabled: true });
  await platform.setSetting(`addedModels:${saved.id}`, JSON.stringify(configured));
  const purpose = input.purpose || providerPurpose({ ...input, modelId, addedModels: models });
  await platform.setSetting(`providerPurpose:${saved.id}`, purpose);
  await publishModelsChanged();
  return { ...saved, addedModels: configured, purpose };
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

const modelListeners = new Set<(enabled: ModelSelection[]) => void>();
/** Changes carry current identities so running plugin requests can be revoked synchronously. */
export function onDidChangeModels(listener: (enabled: ModelSelection[]) => void) {
  modelListeners.add(listener);
  return { dispose: () => modelListeners.delete(listener) };
}
async function publishModelsChanged() {
  const enabled = (await listConfiguredProviders()).flatMap((provider) =>
    enabledModels(provider).map((model) => ({ providerId: provider.id, modelId: model.id })),
  );
  for (const listener of [...modelListeners]) {
    try {
      listener(enabled);
    } catch {
      /* Subscribers cannot break model settings. */
    }
  }
}
export async function removeConfiguredProvider(id: string) {
  await platform.deleteProvider(id);
  await publishModelsChanged();
}
export async function setModelEnabled(
  providerId: string,
  modelId: string,
  enabled: boolean,
): Promise<Provider> {
  const provider = (await listConfiguredProviders()).find((item) => item.id === providerId);
  if (!provider || !addedModels(provider).some((model) => model.id === modelId))
    throw new Error(message("modelNotEnabled"));
  return saveConfiguredProvider({
    ...provider,
    apiKey: "",
    addedModels: addedModels(provider).map((model) =>
      model.id === modelId ? { ...model, enabled } : model,
    ),
  });
}
export async function resolveEnabledModel(
  selection: ModelSelection,
  kind?: "chat" | "ocr",
): Promise<Provider> {
  const provider = (await listConfiguredProviders()).find(
    (item) => item.id === selection.providerId,
  );
  const model = provider && enabledModels(provider).find((item) => item.id === selection.modelId);
  if (
    !provider ||
    !model ||
    (kind === "chat" && !chatModels(provider).some((item) => item.id === model.id)) ||
    (kind === "ocr" && !model.formulaOcr)
  )
    throw new Error(message("modelNotEnabled"));
  return { ...provider, modelId: model.id, addedModels: enabledModels(provider) };
}
export async function listEnabledModels(): Promise<AvailableModel[]> {
  const providers = await listConfiguredProviders();
  return Promise.all(
    providers.flatMap((provider) =>
      enabledModels(provider).map(async (model) => ({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        kind: chatModels(provider).some((item) => item.id === model.id)
          ? ("chat" as const)
          : ("ocr" as const),
        supportsImages: await supportsImages(provider, model.id),
        ...(model.formulaOcr ? { formulaOcr: model.formulaOcr } : {}),
      })),
    ),
  );
}

/** Guard every paid dispatch, including independent OCR batches; revoke work on disable/delete. */
export async function withEnabledModel<T>(
  selection: ModelSelection,
  signal: AbortSignal | undefined,
  run: (provider: Provider, signal: AbortSignal) => Promise<T>,
  kind?: "chat" | "ocr",
): Promise<T> {
  selection = { providerId: selection.providerId, modelId: selection.modelId };
  const controller = new AbortController();
  const subscription = onDidChangeModels((enabled) => {
    if (
      !enabled.some(
        (model) => model.providerId === selection.providerId && model.modelId === selection.modelId,
      )
    )
      controller.abort();
  });
  const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let abort: (() => void) | undefined;
  try {
    const provider = await resolveEnabledModel(selection, kind);
    combined.throwIfAborted();
    const revoked = new Promise<never>((_, reject) => {
      abort = () => reject(new DOMException("Model request cancelled", "AbortError"));
      combined.addEventListener("abort", abort, { once: true });
    });
    return await Promise.race([run(provider, combined), revoked]);
  } finally {
    if (abort) combined.removeEventListener("abort", abort);
    subscription.dispose();
  }
}
