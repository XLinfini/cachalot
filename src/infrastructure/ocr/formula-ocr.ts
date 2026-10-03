import type { FormulaAsset } from "../../domain/analysis";
import type { OcrFormulaInput, OcrCandidate } from "../../domain/ocr-adapter";
import type { Provider } from "../../domain/records";
import { validateOcrImage } from "../../domain/ocr";
import { message } from "../../domain/messages";
import { ocrAdapters } from "./registry";
import { ocrContext } from "./transport";

export async function recognizeFormulas(
  adapterId: string,
  provider: Provider,
  formulas: OcrFormulaInput[],
): Promise<OcrCandidate[]> {
  const adapter = ocrAdapters.require(adapterId);
  if (!formulas.length || formulas.length > adapter.batchSize)
    throw new Error(message("ocrRequestInvalid"));
  for (const formula of formulas) validateOcrImage(formula.imageDataUrl);
  return adapter.recognize(ocrContext(provider), formulas);
}
export async function recognizeFormula(
  adapterId: string,
  provider: Provider,
  asset: Pick<FormulaAsset, "imageDataUrl">,
): Promise<string | null> {
  const candidates = await recognizeFormulas(adapterId, provider, [
    { id: "connection-check", imageDataUrl: asset.imageDataUrl },
  ]);
  const entries = candidates.filter((candidate) => candidate.id === "connection-check");
  return entries.length === 1 ? entries[0].latex : null;
}
