import type { OcrAdapter } from "../../../domain/ocr-adapter";
import { apiEndpoint } from "../../../domain/api-endpoint";
import { formulaLatex } from "../../../domain/ocr";

/** Shared by dedicated OCR deployments exposing OpenAI-compatible chat, such
 * as compatible GLM/PaddleOCR services. Their task prompt belongs here. */
export default {
  id: "formula-chat",
  order: 20,
  batchSize: 1,
  cachePrefix: "formula-ocr-v1:formula-chat",
  label: { zh: "专用公式 OCR · Chat 兼容", en: "Dedicated formula OCR · Chat compatible" },
  endpoint: (baseUrl) => apiEndpoint(baseUrl, "chat/completions"),
  async recognize(context, formulas) {
    const output = await context.transport.complete({
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: formulas[0].imageDataUrl } },
            { type: "text", text: "Formula Recognition:" },
          ],
        },
      ],
    });
    return [{ id: formulas[0].id, latex: formulaLatex(output) }];
  },
} satisfies OcrAdapter;
