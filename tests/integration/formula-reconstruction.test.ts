import assert from "node:assert/strict";
import { test } from "node:test";
import type { FormulaFragment } from "../../src/domain/analysis";
import type { Provider } from "../../src/domain/records";
import type { FormulaRecord } from "../../src/infrastructure/formula-repository";
import { TRANSCRIPTION_VERSION, formulaEvidence } from "../../src/domain/formula-evidence";
import {
  createFormulaReconstructor,
  type FormulaReconstructionPorts,
} from "../../src/application/ocr/reconstruct-formulas";
import { evidenceFormula } from "../fixtures/formulas";

const latex = "C=\\frac{o_\\theta}{0}";
const provider: Provider = {
  id: "fixture-ocr",
  name: "Fixture OCR",
  modelId: "fixture-math",
  baseUrl: "https://fixture.invalid",
  enabled: true,
  hasKey: false,
};
const fallback = { provider: { ...provider, id: "translation" }, supportsImages: false };
const record = (formula: FormulaFragment): FormulaRecord => ({
  id: formula.id,
  documentId: formula.documentId,
  candidates: {},
  asset: { formula, imageDataUrl: "data:image/png;base64,AAAA", width: 100, height: 40, scale: 4 },
});
function harness(overrides: Partial<FormulaReconstructionPorts> = {}) {
  const sources: FormulaFragment[][] = [];
  const requests: Parameters<FormulaReconstructionPorts["recognize"]>[] = [];
  const saved: Array<{ record: FormulaRecord; generation: number | undefined }> = [];
  const ports: FormulaReconstructionPorts = {
    sources: async (formulas) => {
      sources.push(formulas);
      return formulas.map(record);
    },
    getSelection: async () => ({ providerId: provider.id, modelId: provider.modelId }),
    resolveModel: async () => ({ provider, protocol: "fixture-ocr" }),
    adapter: () => ({ cachePrefix: "fixture-v1", batchSize: 1 }),
    recognize: async (...args) => {
      requests.push(args);
      return args[2].map(({ id }) => ({ id, latex }));
    },
    save: async (record, generation) => {
      saved.push({ record, generation });
    },
    generation: () => 7,
    ...overrides,
  };
  return { reconstruct: createFormulaReconstructor(ports), sources, requests, saved };
}

test("OCR receives only requested formula regions, respects independent selection, and leaves source evidence unchanged", async () => {
  const complex = structuredClone(evidenceFormula);
  const native = {
    ...complex,
    id: "native",
    latex: "x^2",
    recognition: "native-candidate" as const,
  };
  const partial = { ...complex, id: "partial", partial: true, latex: "x" };
  const formulas = [complex, native, partial];
  const before = structuredClone(formulas);
  const h = harness();
  const result = await h.reconstruct({ formulas, fallback });
  assert.deepEqual(
    h.sources,
    [before],
    "Crop port receives the exact coverage, including clipped regions",
  );
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0][0], "fixture-ocr");
  assert.deepEqual(
    h.requests[0][1],
    provider,
    "Translation model has no bearing on independently selected OCR",
  );
  assert.deepEqual(h.requests[0][2], [
    {
      id: complex.id,
      imageDataUrl: "data:image/png;base64,AAAA",
      evidence: formulaEvidence(complex),
    },
  ]);
  assert.deepEqual(
    result.assets.map(({ formula }) => [formula.id, formula.latex, formula.recognition]),
    [
      [complex.id, latex, "model-candidate"],
      [native.id, "x^2", "native-candidate"],
      [partial.id, null, "unrecognized"],
    ],
  );
  assert.deepEqual(result.issues, []);
  assert.deepEqual(formulas, before, "OCR results do not overwrite page/selection facts");
  assert.equal(h.saved[0].generation, 7);
  assert.equal(h.saved[0].record.candidates["fixture-v1:fixture-ocr:fixture-math"], latex);
});

test("invalid syntax, changed native characters and ambiguous IDs retain original images and never enter the candidate cache", async () => {
  const formulas = ["syntax", "characters", "duplicate", "missing"].map((id) => ({
    ...evidenceFormula,
    id,
  }));
  const h = harness({
    adapter: () => ({ cachePrefix: "fixture-v1", batchSize: 4 }),
    recognize: async () => [
      { id: "syntax", latex: "\\frac{x}{" },
      { id: "characters", latex: "C=\\frac{0_\\theta}{0}" },
      { id: "duplicate", latex },
      { id: "duplicate", latex },
      { id: "unknown", latex },
    ],
  });
  const result = await h.reconstruct({ formulas, fallback });
  assert.deepEqual(
    result.issues.map((issue) => [issue.formulaId, issue.reason]),
    [
      ["syntax", "invalid"],
      ["characters", "characters"],
      ["duplicate", "invalid"],
      ["missing", "invalid"],
    ],
  );
  assert.ok(
    result.assets.every(
      (asset) =>
        asset.formula.latex === null && asset.imageDataUrl === "data:image/png;base64,AAAA",
    ),
  );
  assert.deepEqual(h.saved, []);
});

test("an explicit plugin OCR model overrides application preferences without consulting or changing them", async () => {
  const selected = { providerId: "plugin-ocr", modelId: "plugin-math" };
  const chosen = { ...provider, id: selected.providerId, modelId: selected.modelId };
  const h = harness({
    getSelection: async () => {
      assert.fail("An explicit model must not consult application OCR preferences");
    },
    resolveModel: async (selection) => {
      assert.deepEqual(selection, selected);
      return { provider: chosen, protocol: "fixture-ocr" };
    },
  });
  const result = await h.reconstruct({ formulas: [evidenceFormula], fallback, model: selected });
  assert.deepEqual(result.issues, []);
  assert.equal(result.assets[0].formula.latex, latex);
  assert.deepEqual(h.requests[0][1], chosen);
  assert.equal(h.saved[0].record.candidates["fixture-v1:plugin-ocr:plugin-math"], latex);
});

test("candidate reuse is scoped to the selected model and adapter version", async () => {
  let modelId = provider.modelId,
    cachePrefix = "fixture-v1";
  const cache = new Map<string, FormulaRecord>();
  const h = harness({
    sources: async (formulas) =>
      formulas.map((f) => {
        const cached = structuredClone(cache.get(f.id) || record(f));
        cached.asset.formula = f; // Same contract as the crop adapter: refresh source evidence.
        return cached;
      }),
    resolveModel: async () => ({ provider: { ...provider, modelId }, protocol: "fixture-ocr" }),
    adapter: () => ({ cachePrefix, batchSize: 1 }),
    save: async (value) => {
      cache.set(value.id, structuredClone(value));
    },
  });
  const request = { formulas: [evidenceFormula], fallback };
  await h.reconstruct(request);
  assert.equal((await h.reconstruct(request)).assets[0].formula.latex, latex);
  assert.equal(h.requests.length, 1, "Same model/version uses the validated candidate");
  modelId = "other-math";
  await h.reconstruct(request);
  assert.equal(h.requests.length, 2);
  cachePrefix = "fixture-v2";
  await h.reconstruct(request);
  assert.equal(h.requests.length, 3);
});

test("a transport failure stops remaining batches and reports every unresolved formula without automatic retry", async () => {
  let requests = 0;
  const h = harness({
    recognize: async () => {
      requests++;
      throw new Error("HTTP 503: fixture unavailable");
    },
  });
  const formulas = ["first", "second", "third"].map((id) => ({ ...evidenceFormula, id }));
  const result = await h.reconstruct({ formulas, fallback });
  assert.equal(requests, 1);
  assert.deepEqual(
    result.issues.map((issue) => issue.formulaId),
    ["first", "second", "third"],
  );
  assert.ok(
    result.issues.every(
      (issue) => issue.reason === "request" && issue.details?.includes("HTTP 503"),
    ),
  );
  assert.ok(result.assets.every((asset) => asset.formula.latex === null));
  assert.deepEqual(h.saved, []);
});

test("disabled or unavailable OCR never falls back to the paid translation model or an unrelated cached candidate", async () => {
  const cached = record(evidenceFormula);
  cached.candidates[`${TRANSCRIPTION_VERSION}:translation:fixture-math`] = latex;
  for (const disabled of [true, false]) {
    const h = harness({
      sources: async () => [structuredClone(cached)],
      getSelection: async () =>
        disabled ? "off" : { providerId: "deleted-provider", modelId: "deleted-model" },
      resolveModel: async () => {
        throw new Error("Configured OCR unavailable");
      },
    });
    const result = await h.reconstruct({
      formulas: [evidenceFormula],
      fallback: { ...fallback, supportsImages: true },
    });
    assert.deepEqual(h.requests, []);
    assert.equal(result.assets[0].formula.latex, null);
    assert.equal(result.issues.length, disabled ? 0 : 1);
  }
});

test("legacy text models can reuse character-checked vision candidates without making a remote request", async () => {
  const cached = record(evidenceFormula);
  cached.candidates[`${TRANSCRIPTION_VERSION}:old-vision:old-model`] = latex;
  const h = harness({ sources: async () => [cached], getSelection: async () => null });
  const result = await h.reconstruct({ formulas: [evidenceFormula], fallback });
  assert.equal(result.assets[0].formula.latex, latex);
  assert.deepEqual(h.requests, []);
  assert.deepEqual(result.issues, []);
});

test("cancellation rejects late OCR results without cache writes or subsequent batches", async () => {
  const controller = new AbortController();
  let requests = 0;
  const h = harness({
    recognize: async (_protocol, _provider, regions, signal) => {
      requests++;
      assert.equal(signal, controller.signal);
      controller.abort();
      // An adapter can finish late even after receiving cancellation.
      return regions.map(({ id }) => ({ id, latex }));
    },
  });
  await assert.rejects(
    h.reconstruct({
      formulas: ["first", "second"].map((id) => ({ ...evidenceFormula, id })),
      fallback,
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.equal(requests, 1);
  assert.deepEqual(h.saved, []);
});

test("cancellation during one cache save prevents remaining candidate writes", async () => {
  const controller = new AbortController(),
    writes: string[] = [];
  const h = harness({
    adapter: () => ({ cachePrefix: "fixture-v1", batchSize: 2 }),
    save: async (value) => {
      writes.push(value.id);
      controller.abort();
    },
  });
  await assert.rejects(
    h.reconstruct({
      formulas: ["first", "second", "third"].map((id) => ({ ...evidenceFormula, id })),
      fallback,
      signal: controller.signal,
    }),
    { name: "AbortError" },
  );
  assert.deepEqual(writes, ["first"]);
  assert.equal(h.requests.length, 1);
});
