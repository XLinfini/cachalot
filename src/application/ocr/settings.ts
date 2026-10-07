import type { FormulaOcrProtocol, ModelSelection, Provider } from "../../domain/records";
import { addedModels, enabledModels } from "../../domain/provider-models";
import { message } from "../../domain/messages";
import { platform } from "../../infrastructure/platform";
import { listConfiguredProviders, supportsImages } from "../model-catalog";
import { recognizeFormula } from "../../infrastructure/ocr/formula-ocr";
import { validLatex } from "./validate-latex";
import { ocrTestImage } from "../../infrastructure/ocr/test-formula";
import { ocrAdapters } from "../../infrastructure/ocr/registry";

/** Explicit connection check sends one locally rendered test formula. It does
 * not upload a paper or call /models on a fixed-engine OCR API. */
export async function testOcrProvider(provider: Provider): Promise<string> {
  const model = addedModels(provider).find((m) => m.id === provider.modelId);
  if (!model?.formulaOcr) return platform.testProvider(provider.id);
  ocrAdapters.require(model.formulaOcr);
  const latex = await recognizeFormula(model.formulaOcr, provider, {
    imageDataUrl: ocrTestImage(),
  });
  if (!validLatex(latex)) throw new Error(message("ocrTestFailed"));
  return message("connectionSucceeded");
}

export const OCR_MODEL_SETTING = "formulaOcrModel";
export type OcrSelection = ModelSelection | "off" | null;

export function parseOcrSelection(value: string | null): OcrSelection {
  if (!value) return null; // Existing installations retain their vision LLM flow.
  if (value === "off") return "off";
  try {
    const model = JSON.parse(value);
    if (typeof model?.providerId === "string" && typeof model?.modelId === "string") return model;
  } catch {
    /* Invalid persisted selection is an error, never a paid fallback. */
  }
  throw new Error(message("configureOcr"));
}
export const getOcrSelection = async () =>
  parseOcrSelection(await platform.getSetting(OCR_MODEL_SETTING));

export async function saveOcrSelection(value: OcrSelection): Promise<void> {
  if (value && value !== "off") await selectedOcrModel(value);
  await platform.setSetting(
    OCR_MODEL_SETTING,
    value === "off" ? "off" : value ? JSON.stringify(value) : "",
  );
}

export async function selectedOcrModel(
  selection: ModelSelection,
): Promise<{ provider: Provider; protocol: FormulaOcrProtocol }> {
  const provider = (await listConfiguredProviders()).find((p) => p.id === selection.providerId);
  const model = provider && enabledModels(provider).find((m) => m.id === selection.modelId);
  if (!provider || !model?.formulaOcr) throw new Error(message("configureOcr"));
  const adapter = ocrAdapters.require(model.formulaOcr);
  if (adapter.requiresVision && !(await supportsImages(provider, model.id)))
    throw new Error(message("configureOcr"));
  return { provider: { ...provider, modelId: model.id }, protocol: model.formulaOcr };
}
