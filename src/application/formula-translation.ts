import type { FormulaAsset, FormulaPreparationIssue, SelectedRegion } from "../domain/analysis";
import type { FormulaOcrProtocol, Provider } from "../domain/records";
import { formulaSources } from "../infrastructure/pdf/formula-source";
import { formulaRepository } from "../infrastructure/formula-repository";
import { getOcrSelection, selectedOcrModel } from "./ocr-settings";
import { recognizeFormulas } from "../infrastructure/ocr/formula-ocr";
import { ocrAdapters } from "../infrastructure/ocr/registry";
import { message } from "../domain/messages";
import { cacheGeneration } from "../infrastructure/cache-writes";

import { formulaMarker } from "./formula-references";
import {
  TRANSCRIPTION_VERSION,
  formulaEvidence,
  preservesNativeCharacters,
  validLatex,
} from "./formula-transcription";

/** Formula recognition runs on demand with the independently selected OCR
 * service (or the legacy vision LLM). Checks do not prove mathematical correctness. */
export async function prepareFormulas(
  selection: SelectedRegion,
  provider: Provider,
  vision: boolean,
): Promise<{ assets: FormulaAsset[]; glossary: string; issues: FormulaPreparationIssue[] }> {
  const generation = cacheGeneration("formulas");
  const records = await formulaSources(selection.formulas || []);
  let protocol: FormulaOcrProtocol = "vision-llm";
  let legacy = true;
  let cacheAllowed = true;
  let recognitionDisabled = false;
  let configurationError: string | null = null;
  try {
    const selected = await getOcrSelection();
    if (selected) {
      legacy = false;
      if (selected === "off") {
        vision = false;
        cacheAllowed = false;
        recognitionDisabled = true;
      } else {
        const resolved = await selectedOcrModel(selected);
        provider = resolved.provider;
        protocol = resolved.protocol;
        vision = true;
      }
    }
  } catch (error) {
    legacy = false;
    vision = false;
    cacheAllowed = false;
    configurationError = String(error);
  }
  const adapter = ocrAdapters.get(protocol);
  if (!adapter && !recognitionDisabled) {
    vision = false;
    cacheAllowed = false;
    configurationError ||= message("ocrAdapterUnavailable", { adapter: protocol });
  }
  const key = `${adapter?.cachePrefix || "unavailable"}:${provider.id}:${provider.modelId}`;
  const issues: FormulaPreparationIssue[] = [];
  const acceptable = (formula: FormulaAsset["formula"], value: unknown): value is string =>
    validLatex(value) && preservesNativeCharacters(formula, value);
  const readingLatex = (record: (typeof records)[number]) =>
    validLatex(record.asset.formula.latex)
      ? record.asset.formula.latex
      : cacheAllowed && acceptable(record.asset.formula, record.candidates[key])
        ? record.candidates[key]
        : legacy && !vision
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
      (!cacheAllowed || !acceptable(r.asset.formula, r.candidates[key])),
  );
  if (vision && adapter)
    for (let offset = 0; offset < unresolved.length; offset += adapter.batchSize) {
      const batch = unresolved.slice(offset, offset + adapter.batchSize);
      try {
        const candidates = await recognizeFormulas(
          protocol,
          provider,
          batch.map((record) => ({
            id: record.id,
            imageDataUrl: record.asset.imageDataUrl,
            evidence: formulaEvidence(record.asset.formula),
          })),
        );
        for (const record of batch) {
          const entries = candidates.filter((candidate) => candidate.id === record.id);
          const latex = entries.length === 1 ? entries[0].latex : null;
          if (!validLatex(latex)) issues.push({ formulaId: record.id, reason: "invalid" });
          else if (!preservesNativeCharacters(record.asset.formula, latex))
            issues.push({ formulaId: record.id, reason: "characters" });
          else {
            record.candidates[key] = latex;
            await formulaRepository.put(record, generation);
          }
        }
      } catch (error) {
        for (const record of unresolved.slice(offset))
          if (!acceptable(record.asset.formula, record.candidates[key]))
            issues.push({ formulaId: record.id, reason: "request", details: String(error) });
        break; // Never automatically repeat a failed provider request.
      }
    }
  if (!vision && !recognitionDisabled)
    for (const record of unresolved)
      if (!readingLatex(record))
        issues.push({
          formulaId: record.id,
          reason: configurationError ? "request" : "vision-unavailable",
          ...(configurationError ? { details: configurationError } : {}),
        });
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
