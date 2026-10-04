import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheFixture } from "../fixtures/cache";
import { semanticFixture } from "../fixtures/document-semantics";

test("desktop formula writes satisfy the shared SQLite envelope and cache commands use the native adapter", async () => {
  const records = new Map<string, string>();
  const calls: string[] = [];
  Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, input: Record<string, unknown> = {}) => {
          calls.push(command);
          if (command === "save_page_analysis") {
            const content = JSON.parse(String(input.content));
            assert.equal(content.schemaVersion, 1);
            assert.equal(content.page, input.page);
            assert.equal(content.documentId, input.documentId);
            assert.equal(content.cacheKey, input.cacheKey);
            records.set(String(input.cacheKey), String(input.content));
          } else if (command === "get_page_analysis")
            return records.get(String(input.cacheKey)) || null;
          else if (command === "save_document_semantics") {
            const document = JSON.parse(String(input.content));
            assert.equal(document.kind, "document-semantics");
            assert.equal(document.documentId, input.documentId);
            assert.equal(document.cacheKey, input.cacheKey);
            records.set(String(input.cacheKey), String(input.content));
          } else if (command === "get_document_semantics")
            return records.get(String(input.cacheKey)) || null;
          else if (command === "cache_usage")
            return [{ kind: "formulas", bytes: 123, entries: records.size, candidates: 2 }];
          else if (command === "clear_cache") {
            assert.equal(input.kind, "formulas");
            records.clear();
          } else throw new Error(`Unexpected command: ${command}`);
        },
      },
    },
  });
  try {
    const { formulaRepository } = await import("../../src/infrastructure/formula-repository");
    const { cacheRepository } = await import("../../src/infrastructure/cache-management");
    const { analysisRepository } = await import("../../src/infrastructure/analysis/repository");
    const { semanticsRepository } =
      await import("../../src/infrastructure/analysis/semantics-repository");
    await formulaRepository.put(cacheFixture.formula);
    const read = await formulaRepository.get(cacheFixture.formula.asset.formula);
    assert.deepEqual(read?.asset, cacheFixture.formula.asset);
    assert.deepEqual(read?.candidates, cacheFixture.formula.candidates);
    assert.equal((await cacheRepository.usage())[0].entries, 1);
    const fixture = semanticFixture(1, [
      { kind: "paragraph", text: "Source", box: [0.1, 0.1, 0.8, 0.2] },
    ]);
    await analysisRepository.putFacts(fixture.facts);
    await analysisRepository.putObservations(fixture.observations);
    await semanticsRepository.put(fixture.semantics);
    assert.deepEqual(await analysisRepository.getFacts(fixture.facts.documentId, 1), fixture.facts);
    assert.deepEqual(
      await analysisRepository.getObservations(fixture.facts.documentId, 1),
      fixture.observations,
    );
    assert.deepEqual(
      await semanticsRepository.get(fixture.facts.documentId, 1),
      JSON.parse(JSON.stringify(fixture.semantics)),
    );
    await cacheRepository.clear("formulas");
    assert.equal(await formulaRepository.get(cacheFixture.formula.asset.formula), null);
    assert.ok(calls.includes("clear_cache"));
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "isTauri");
  }
});
