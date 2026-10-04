import type { FormulaAsset, FormulaFragment, FormulaPreparationIssue } from "../../domain/analysis";
import type { FormulaOcrProtocol, Provider } from "../../domain/records";
import type { OcrAdapter } from "../../domain/ocr-adapter";
import { formulaRepository, type FormulaRecord } from "../../infrastructure/formula-repository";
import { getOcrSelection, selectedOcrModel } from "./settings";
import { recognizeFormulas } from "../../infrastructure/ocr/formula-ocr";
import { ocrAdapters } from "../../infrastructure/ocr/registry";
import { message } from "../../domain/messages";
import { cacheGeneration } from "../../infrastructure/cache-writes";
import { TRANSCRIPTION_VERSION, formulaEvidence } from "../../domain/formula-evidence";
import { preservesNativeCharacters, validLatex } from "./validate-latex";

/** Exact formula regions come from selection coverage. This service does not
 * inspect the whole selection, generate translation markers or mutate semantics. */
export interface FormulaReconstructionRequest {
  formulas: FormulaFragment[];
  /** Used only by existing installations without an explicit OCR selection. */
  fallback: { provider: Provider; supportsImages: boolean };
}
export interface FormulaReconstructionResult {
  assets: FormulaAsset[];
  issues: FormulaPreparationIssue[];
}

/** Narrow side-effect ports keep crop rendering, transport and storage in
 * infrastructure. Tests can exercise orchestration without a browser or network. */
export interface FormulaReconstructionPorts {
  sources(formulas: FormulaFragment[]): Promise<FormulaRecord[]>;
  getSelection: typeof getOcrSelection;
  resolveModel: typeof selectedOcrModel;
  adapter(protocol: FormulaOcrProtocol): Pick<OcrAdapter, "cachePrefix" | "batchSize"> | undefined;
  recognize: typeof recognizeFormulas;
  save: typeof formulaRepository.put;
  generation(): number;
}

/** Recognition is on demand. Only syntactically valid, character-preserving
 * candidates leave this boundary; these checks do not prove mathematical accuracy. */
export function createFormulaReconstructor(ports: FormulaReconstructionPorts) {
  return async (request: FormulaReconstructionRequest): Promise<FormulaReconstructionResult> => {
    let { provider, supportsImages: vision } = request.fallback;
    const generation = ports.generation();
    const records = await ports.sources(request.formulas);
    if (!records.length) return { assets: [], issues: [] };
    let protocol: FormulaOcrProtocol = "vision-llm";
    let legacy = true;
    let cacheAllowed = true;
    let recognitionDisabled = false;
    let configurationError: string | null = null;
    try {
      const selected = await ports.getSelection();
      if (selected) {
        legacy = false;
        if (selected === "off") {
          vision = false;
          cacheAllowed = false;
          recognitionDisabled = true;
        } else {
          const resolved = await ports.resolveModel(selected);
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
    const adapter = ports.adapter(protocol);
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
          const candidates = await ports.recognize(
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
              await ports.save(record, generation);
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
    return {
      assets: records.map((record) => {
        const formula = record.asset.formula;
        const latex = formula.partial ? null : readingLatex(record);
        return {
          ...record.asset,
          formula: {
            ...formula,
            latex,
            recognition: latex
              ? validLatex(formula.latex)
                ? formula.recognition
                : "model-candidate"
              : "unrecognized",
          },
        };
      }),
      issues,
    };
  };
}

export const reconstructFormulas = createFormulaReconstructor({
  // Load the crop adapter only when a selection actually needs sources.
  sources: async (formulas) =>
    formulas.length
      ? (await import("../../infrastructure/pdf/formula-source")).formulaSources(formulas)
      : [],
  getSelection: getOcrSelection,
  resolveModel: selectedOcrModel,
  adapter: (protocol) => ocrAdapters.get(protocol),
  recognize: recognizeFormulas,
  save: (record, generation) => formulaRepository.put(record, generation),
  generation: () => cacheGeneration("formulas"),
});
