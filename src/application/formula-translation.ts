import type { FormulaAsset, FormulaPreparationIssue, SelectedRegion } from "../domain/analysis";
import type { FormulaOcrProtocol, Provider } from "../domain/records";
import { formulaSources } from "../infrastructure/pdf/formula-source";
import { formulaRepository } from "../infrastructure/formula-repository";
import { platform } from "../infrastructure/platform";
import { getOcrSelection, selectedOcrModel } from "./ocr-settings";
import { OCR_ADAPTER_VERSION, recognizeFormula } from "../infrastructure/ocr/formula-ocr";

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

/** Formula recognition runs on demand with the independently selected OCR
 * service (or the legacy vision LLM). Checks do not prove mathematical correctness. */
export async function prepareFormulas(
  selection: SelectedRegion,
  provider: Provider,
  vision: boolean,
): Promise<{ assets: FormulaAsset[]; glossary: string; issues: FormulaPreparationIssue[] }> {
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
  const key =
    protocol === "vision-llm"
      ? candidateKey(provider)
      : `${OCR_ADAPTER_VERSION}:${protocol}:${provider.id}:${provider.modelId}`;
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
  if (vision && protocol !== "vision-llm") {
    for (let offset = 0; offset < unresolved.length; offset++) {
      const record = unresolved[offset];
      try {
        const latex = await recognizeFormula(protocol, provider, record.asset);
        if (!validLatex(latex)) issues.push({ formulaId: record.id, reason: "invalid" });
        else if (!preservesNativeCharacters(record.asset.formula, latex))
          issues.push({ formulaId: record.id, reason: "characters" });
        else {
          record.candidates[key] = latex;
          await formulaRepository.put(record);
        }
      } catch (error) {
        for (const pending of unresolved.slice(offset))
          issues.push({ formulaId: pending.id, reason: "request", details: String(error) });
        break; // One failed request stops this selection; never auto-retry.
      }
    }
  }
  if (vision && protocol === "vision-llm")
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
