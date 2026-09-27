import { message } from "./messages";
import type { ModelInfo } from "./records";

export const GLM_OCR_MODEL: ModelInfo = { id: "glm-ocr", formulaOcr: "glm-layout" };
export const GLM_OCR_BASE_URL = "https://open.bigmodel.cn/api/paas/v4";

/** Same resolver in Rust and TypeScript. Explicit gateway paths remain intact;
 * a bare GLM origin uses the documented /api/paas/v4 base, never /v1. */
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

export function validateOcrImage(value: string): void {
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length > Math.ceil((10 * 1024 * 1024) / 3) * 4)
    throw new Error(message("ocrImageInvalid"));
}

/** Strip transport wrappers only. Do not repair symbols, infer missing math,
 * or merge multiple recognized formulas into a single source region. */
export function formulaLatex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value
    .trim()
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const pairs = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [start, end] of pairs)
    if (text.startsWith(start) && text.endsWith(end)) {
      text = text.slice(start.length, -end.length).trim();
      break;
    }
  // Leftover delimiters or markup usually indicate multiple blocks/prose.
  if (!text || /\$|\\[\[\]()]|```|<\/?\w|^#/m.test(text)) return null;
  return text;
}

/** GLM's public layout API returns Markdown and per-page layout arrays.
 * Prefer a single formula block; reject ambiguous multi-formula crops. */
export function glmFormulaLatex(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = body as { layout_details?: unknown; md_results?: unknown };
  const blocks = Array.isArray(data.layout_details) ? data.layout_details.flat() : [];
  const formulas = blocks.filter((block) => block?.label === "formula");
  if (formulas.length) return formulas.length === 1 ? formulaLatex(formulas[0].content) : null;
  // Markdown may describe a failure or contain ordinary prose. Only an
  // explicitly delimited math block is a fallback when no formula is labeled.
  if (
    typeof data.md_results !== "string" ||
    !/^\s*(?:\$|\\\[|\\\(|```(?:latex|tex))/i.test(data.md_results)
  )
    return null;
  return formulaLatex(data.md_results);
}
