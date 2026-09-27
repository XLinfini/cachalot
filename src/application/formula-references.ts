import type { FormulaAsset, TranslationResult } from "../domain/analysis";
import { message } from "../domain/messages";

export const FORMULA_PATTERN = /\[\[formula:([a-zA-Z0-9-]+)\]\]/g;
export const formulaMarker = (id: string) => `[[formula:${id}]]`;
export const FORMULA_TRANSLATION_POLICY =
  "正文里的 [[formula:ID]] 是原公式的位置标记。翻译时必须将每个标记原样保留一次，保持它们的顺序及行内/行间位置，不能用 LaTeX、文字或占位词替换，不能新增标记。公式阅读候选只用于理解上下文，不得据此改写、补全或重建公式。";

/** Missing/duplicated/reordered formulas fail visibly, never silently vanish. */
export function finishTranslation(
  source: string,
  markdown: string,
  formulas: FormulaAsset[],
): TranslationResult {
  const ids = (value: string) => [...value.matchAll(FORMULA_PATTERN)].map((match) => match[1]);
  const expected = ids(source),
    actual = ids(markdown);
  if (
    JSON.stringify(expected) !== JSON.stringify(actual) ||
    expected.some((id) => !formulas.some((f) => f.formula.id === id))
  )
    throw new Error(message("formulaReferencesChanged"));
  return { markdown, formulas };
}

/** Clipboard text and LaTeX reflow use the same prepared formula candidates. */
export function formulaClipboard(markdown: string, assets: FormulaAsset[]): string {
  return markdown.replace(FORMULA_PATTERN, (marker, id: string) => {
    const formula = assets.find((a) => a.formula.id === id)?.formula;
    return formula?.latex && !formula.partial
      ? `${formula.mode === "display" ? "$$" : "$"}${formula.latex}${formula.mode === "display" ? "$$" : "$"}`
      : marker;
  });
}
