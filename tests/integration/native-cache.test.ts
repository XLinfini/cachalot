import assert from "node:assert/strict";
import { test } from "node:test";
import { cacheFixture } from "../fixtures/cache";

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
    await formulaRepository.put(cacheFixture.formula);
    const read = await formulaRepository.get(cacheFixture.formula.asset.formula);
    assert.deepEqual(read?.asset, cacheFixture.formula.asset);
    assert.deepEqual(read?.candidates, cacheFixture.formula.candidates);
    assert.equal((await cacheRepository.usage())[0].entries, 1);
    await cacheRepository.clear("formulas");
    assert.equal(await formulaRepository.get(cacheFixture.formula.asset.formula), null);
    assert.ok(calls.includes("clear_cache"));
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "isTauri");
  }
});
