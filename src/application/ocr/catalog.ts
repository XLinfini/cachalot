import { ocrAdapters } from "../../infrastructure/ocr/registry";
import type { ProviderInput } from "../../domain/records";

/** Settings consumes adapter metadata through the same facade as recognition. */
export const listOcrAdapters = () =>
  ocrAdapters.list().map(({ id, label, description, requiresVision }) => ({
    id,
    label,
    description,
    requiresVision: !!requiresVision,
  }));
export const listOcrPresets = () =>
  ocrAdapters
    .list()
    .flatMap((adapter) =>
      (adapter.presets || []).map((preset) => ({ ...preset, adapterId: adapter.id })),
    );
export const ocrRequestEndpoint = (adapterId: string, baseUrl: string) =>
  ocrAdapters.require(adapterId).endpoint(baseUrl);
export function createOcrPreset(presetId: string): ProviderInput {
  const preset = listOcrPresets().find((preset) => preset.id === presetId);
  if (!preset) throw new Error(`Unknown OCR preset: ${presetId}`);
  return {
    id: crypto.randomUUID(),
    purpose: "ocr",
    name: preset.name,
    baseUrl: preset.baseUrl,
    modelId: preset.models[0]?.id || "",
    enabled: true,
    apiKey: "",
    addedModels: preset.models.map((model) => ({ ...model, formulaOcr: preset.adapterId })),
  };
}
