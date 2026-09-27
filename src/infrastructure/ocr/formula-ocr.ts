import type { FormulaAsset } from "../../domain/analysis";
import type { FormulaOcrProtocol, Provider } from "../../domain/records";
import { formulaLatex, glmFormulaLatex } from "../../domain/ocr";
import { platform } from "../platform";

export const OCR_ADAPTER_VERSION = "formula-ocr-v1";

/** Dedicated OCR inputs are single image crops and fixed task prompts.
 * Native PDF characters are checked by the application after recognition;
 * they are not forced into an OCR endpoint that cannot consume them. */
export async function recognizeFormula(
  protocol: Exclude<FormulaOcrProtocol, "vision-llm">,
  provider: Provider,
  asset: Pick<FormulaAsset, "imageDataUrl">,
): Promise<string | null> {
  if (protocol === "glm-layout") {
    return glmFormulaLatex(
      await platform.glmOcr({
        providerId: provider.id,
        modelId: provider.modelId,
        imageDataUrl: asset.imageDataUrl,
      }),
    );
  }
  let output = "";
  await platform.complete(
    {
      providerId: provider.id,
      modelId: provider.modelId,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: asset.imageDataUrl } },
            { type: "text", text: "Formula Recognition:" },
          ],
        },
      ],
    },
    (delta) => {
      output += delta;
    },
  );
  return formulaLatex(output);
}
