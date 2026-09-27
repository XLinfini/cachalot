import katex from "katex";
import type { FormulaAsset, SelectedRegion } from "../domain/analysis";
import type { Provider } from "../domain/records";
import { formulaSources } from "../infrastructure/pdf/formula-source";
import { formulaRepository } from "../infrastructure/formula-repository";
import { platform } from "../infrastructure/platform";

import { formulaMarker } from "./formula-references";
const candidateKey = (provider: Provider) => `transcribe-v1:${provider.id}:${provider.modelId}`;

function validLatex(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 12000 ||
    /\\(?:href|url|includegraphics|html|def|newcommand|require)\b/.test(value)
  )
    return false;
  try {
    katex.renderToString(value, { throwOnError: true, trust: false, strict: "error" });
    return true;
  } catch {
    return false;
  }
}

/** Expensive formula transcription runs on demand, on the user's selected
 * image model. Results are only syntax-checked candidates, not verified math. */
export async function prepareFormulas(
  selection: SelectedRegion,
  provider: Provider,
  vision: boolean,
): Promise<{ assets: FormulaAsset[]; glossary: string }> {
  const records = await formulaSources(selection.formulas || []);
  const key = candidateKey(provider);
  const readingLatex = (record: (typeof records)[number]) =>
    validLatex(record.asset.formula.latex)
      ? record.asset.formula.latex
      : validLatex(record.candidates[key])
        ? record.candidates[key]
        : !vision
          ? Object.values(record.candidates).find(validLatex) || null
          : null;
  const unresolved = records.filter(
    (r) =>
      !r.asset.formula.partial &&
      !validLatex(r.asset.formula.latex) &&
      !validLatex(r.candidates[key]),
  );
  if (vision)
    for (let offset = 0; offset < unresolved.length; offset += 12) {
      const batch = unresolved.slice(offset, offset + 12);
      let output = "";
      try {
        await platform.complete(
          {
            providerId: provider.id,
            modelId: provider.modelId,
            temperature: 0,
            messages: [
              {
                role: "system",
                content:
                  "仅转写图片中的数学公式为 LaTeX，不翻译、不求解、不化简、不纠正作者。保留所有上下标、分数、括号、积分界限及原有函数写法；忽略右侧独立的公式编号。无法确定时 latex 为 null。返回纯 JSON 数组，每项只有 id 和 latex，latex 不带美元符号。不要根据邻近文字猜测符号。",
              },
              {
                role: "user",
                content: batch.flatMap((r) => [
                  { type: "text", text: `id: ${r.id}` },
                  { type: "image_url", image_url: { url: r.asset.imageDataUrl } },
                ]),
              },
            ],
          },
          (delta) => {
            output += delta;
          },
        );
        const values: unknown = JSON.parse(
          output
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, ""),
        );
        if (Array.isArray(values))
          for (const record of batch) {
            const entries = values.filter((item) => item?.id === record.id);
            if (entries.length === 1 && validLatex(entries[0].latex)) {
              record.candidates[key] = entries[0].latex;
              await formulaRepository.put(record);
            }
          }
      } catch {
        // Source formulas remain usable even if OCR/network/syntax fails.
        // Failed recognition is not cached, so a later request can retry.
      }
    }
  const glossary = records
    .map((r) => {
      const formula = r.asset.formula;
      const latex = formula.partial ? null : readingLatex(r);
      return `${formulaMarker(formula.id)}：${formula.partial ? "选区只包含公式的一部分，禁止补全" : latex ? `LaTeX 阅读候选（未验证）：$${latex}$` : "公式原图，尚无可靠 LaTeX，不要猜测或补写"}`;
    })
    .join("\n");
  return {
    assets: records.map((r) => {
      const latex = readingLatex(r);
      return !r.asset.formula.partial && !validLatex(r.asset.formula.latex) && validLatex(latex)
        ? { ...r.asset, formula: { ...r.asset.formula, latex, recognition: "model-candidate" } }
        : r.asset;
    }),
    glossary,
  };
}
