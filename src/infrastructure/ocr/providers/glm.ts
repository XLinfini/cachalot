import type { ModelInfo } from "../../../domain/records";
import type { OcrAdapter } from "../../../domain/ocr-adapter";
import { message } from "../../../domain/messages";
import { formulaLatex } from "../../../domain/ocr";

export const GLM_OCR_MODEL: ModelInfo = { id: "glm-ocr", formulaOcr: "glm-layout" };
export const GLM_OCR_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
export function glmOcrEndpoint(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error(message("invalidApiUrl"));
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error(message("invalidApiUrl"));
  const path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/(?:layout_parsing|chat\/completions|models)$/, "");
  url.pathname = `${path || "/api/paas/v4"}/layout_parsing`;
  url.hash = "";
  return url.toString();
}

/** Prefer exactly one labeled formula; never merge multiple source equations. */
export function glmFormulaLatex(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = body as { layout_details?: unknown; md_results?: unknown };
  const blocks = Array.isArray(data.layout_details) ? data.layout_details.flat() : [];
  const formulas = blocks.filter((block) => block?.label === "formula");
  if (formulas.length) return formulas.length === 1 ? formulaLatex(formulas[0].content) : null;
  if (
    typeof data.md_results !== "string" ||
    !/^\s*(?:\$|\\\[|\\\(|```(?:latex|tex))/i.test(data.md_results)
  )
    return null;
  return formulaLatex(data.md_results);
}

export default {
  id: "glm-layout",
  order: 10,
  batchSize: 1,
  cachePrefix: "formula-ocr-v1:glm-layout",
  label: { zh: "GLM 专用版面接口", en: "GLM layout API" },
  description: {
    zh: "GLM 官方版面 API 当前仅支持 glm-ocr。预设直接提供模型列表，不请求 /models。可填写智谱或 Z.AI 官方地址，也可使用兼容网关。",
    en: "The official GLM layout API currently supports glm-ocr only. Its preset supplies the model list without calling /models. Use a Zhipu, Z.AI or compatible gateway address.",
  },
  presets: [
    {
      id: "glm-ocr",
      name: "GLM-OCR",
      baseUrl: GLM_OCR_BASE_URL,
      models: [GLM_OCR_MODEL],
      buttonLabel: { zh: "添加 GLM-OCR 预设", en: "Add GLM-OCR preset" },
    },
  ],
  endpoint: glmOcrEndpoint,
  async listModels() {
    return [{ ...GLM_OCR_MODEL }];
  },
  async recognize(context, formulas) {
    const response = await context.transport.json({
      url: glmOcrEndpoint(context.baseUrl),
      body: {
        model: context.modelId,
        file: formulas[0].imageDataUrl,
        return_crop_images: false,
        need_layout_visualization: false,
      },
    });
    const body = response.body as { error?: unknown; code?: unknown } | null;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      (body.error && body.error !== false) ||
      (body.code !== undefined && ![0, "0", 200, "200"].includes(body.code as string | number))
    )
      throw new Error(message("ocrResponseError", { details: response.details }));
    return [{ id: formulas[0].id, latex: glmFormulaLatex(body) }];
  },
} satisfies OcrAdapter;
