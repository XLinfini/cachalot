import type { OcrAdapter } from "../../../domain/ocr-adapter";
import { apiEndpoint } from "../../../domain/api-endpoint";
import {
  FORMULA_TRANSCRIPTION_PROMPT,
  TRANSCRIPTION_VERSION,
} from "../../../domain/formula-evidence";

/** Vision LLMs can consume native PDF evidence, unlike fixed-task OCR APIs. */
export default {
  id: "vision-llm",
  order: 30,
  batchSize: 12,
  requiresVision: true,
  cachePrefix: TRANSCRIPTION_VERSION,
  label: { zh: "多模态 LLM · 字符证据", en: "Vision LLM · character evidence" },
  endpoint: (baseUrl) => apiEndpoint(baseUrl, "chat/completions"),
  async recognize(context, formulas) {
    const output = await context.transport.complete({
      temperature: 0,
      messages: [
        { role: "system", content: FORMULA_TRANSCRIPTION_PROMPT },
        {
          role: "user",
          content: formulas.flatMap((formula) => [
            { type: "text", text: JSON.stringify(formula.evidence || { id: formula.id }) },
            { type: "image_url", image_url: { url: formula.imageDataUrl } },
          ]),
        },
      ],
    });
    let values: unknown;
    try {
      values = JSON.parse(
        output
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, ""),
      );
    } catch {
      return formulas.map((formula) => ({ id: formula.id, latex: null }));
    }
    return formulas.map((formula) => {
      const entries = Array.isArray(values) ? values.filter((item) => item?.id === formula.id) : [];
      return {
        id: formula.id,
        latex:
          entries.length === 1 && typeof entries[0].latex === "string" ? entries[0].latex : null,
      };
    });
  },
} satisfies OcrAdapter;
