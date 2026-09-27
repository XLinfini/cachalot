import type { FormulaAsset, FormulaPreparationIssue, SelectedRegion } from "../domain/analysis";
import type { Provider } from "../domain/records";
import { formulaSources } from "../infrastructure/pdf/formula-source";
import { formulaRepository } from "../infrastructure/formula-repository";
import { platform } from "../infrastructure/platform";

import { formulaMarker } from "./formula-references";
import {
  FORMULA_TRANSCRIPTION_PROMPT,
  TRANSCRIPTION_VERSION,
  formulaEvidence,
  preservesNativeCharacters,
  validLatex,
} from "./formula-transcription";
const candidateKey = (provider: Provider) =>
  `${TRANSCRIPTION_VERSION}:${provider.id}:${provider.modelId}`;

/** Expensive formula transcription runs on demand, on the user's selected
 * image model. Results pass syntax and native character checks, but are not verified math. */
export async function prepareFormulas(
  selection: SelectedRegion,
  provider: Provider,
  vision: boolean,
): Promise<{ assets: FormulaAsset[]; glossary: string; issues: FormulaPreparationIssue[] }> {
  const records = await formulaSources(selection.formulas || []);
  const key = candidateKey(provider);
  const issues: FormulaPreparationIssue[] = [];
  const acceptable = (formula: FormulaAsset["formula"], value: unknown): value is string =>
    validLatex(value) && preservesNativeCharacters(formula, value);
  const readingLatex = (record: (typeof records)[number]) =>
    validLatex(record.asset.formula.latex)
      ? record.asset.formula.latex
      : acceptable(record.asset.formula, record.candidates[key])
        ? record.candidates[key]
        : !vision
          ? Object.entries(record.candidates).find(
              ([cacheKey, value]) =>
                cacheKey.startsWith(`${TRANSCRIPTION_VERSION}:`) &&
                acceptable(record.asset.formula, value),
            )?.[1] || null
          : null;
  const unresolved = records.filter(
    (r) =>
      !r.asset.formula.partial &&
      !validLatex(r.asset.formula.latex) &&
      !acceptable(r.asset.formula, r.candidates[key]),
  );
  if (vision)
    for (let offset = 0; offset < unresolved.length; offset += 12) {
      const batch = unresolved.slice(offset, offset + 12);
      let output = "";
      let received = false;
      try {
        await platform.complete(
          {
            providerId: provider.id,
            modelId: provider.modelId,
            temperature: 0,
            messages: [
              {
                role: "system",
                content: FORMULA_TRANSCRIPTION_PROMPT,
              },
              {
                role: "user",
                content: batch.flatMap((r) => [
                  { type: "text", text: JSON.stringify(formulaEvidence(r.asset.formula)) },
                  { type: "image_url", image_url: { url: r.asset.imageDataUrl } },
                ]),
              },
            ],
          },
          (delta) => {
            output += delta;
          },
        );
        received = true;
        const values: unknown = JSON.parse(
          output
            .trim()
            .replace(/^```(?:json)?\s*/i, "")
            .replace(/\s*```$/, ""),
        );
        for (const record of batch) {
          const entries = Array.isArray(values)
            ? values.filter((item) => item?.id === record.id)
            : [];
          const latex: unknown = entries.length === 1 ? entries[0].latex : null;
          if (!validLatex(latex)) {
            issues.push({ formulaId: record.id, reason: "invalid" });
          } else if (!preservesNativeCharacters(record.asset.formula, latex)) {
            issues.push({ formulaId: record.id, reason: "characters" });
          } else {
            record.candidates[key] = latex;
            await formulaRepository.put(record);
          }
        }
      } catch (error) {
        // Failed candidates never enter the cache. Retain source assets and
        // report failure instead of silently hiding the provider's diagnostic.
        for (const record of received ? batch : unresolved.slice(offset))
          if (!acceptable(record.asset.formula, record.candidates[key]))
            issues.push({
              formulaId: record.id,
              reason: received ? "invalid" : "request",
              ...(received ? {} : { details: String(error) }),
            });
        if (!received) break; // Do not repeat a failed provider request for later batches.
      }
    }
  if (!vision)
    for (const record of unresolved)
      if (!readingLatex(record))
        issues.push({ formulaId: record.id, reason: "vision-unavailable" });
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
    issues,
  };
}
