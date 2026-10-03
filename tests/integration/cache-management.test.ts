import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { cacheRepository } from "../../src/infrastructure/cache-management";
import {
  cacheGeneration,
  clearCacheRecords,
  writeCache,
} from "../../src/infrastructure/cache-writes";
import { analysisRepository } from "../../src/infrastructure/analysis/repository";
import { formulaRepository } from "../../src/infrastructure/formula-repository";
import { platform } from "../../src/infrastructure/platform";
import { CACHE_KINDS } from "../../src/domain/cache";
import { cacheFixture } from "../fixtures/cache";
import { seedCaches } from "../support/seed-caches";

const storage: Record<string, string> = Object.create(null);
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: {
      value: (key: string, value: string) => {
        storage[key] = value;
      },
    },
    removeItem: {
      value: (key: string) => {
        delete storage[key];
      },
    },
  }),
});

test("counts all cache versions in UTF-8 bytes and clears each type without touching user data", async () => {
  await seedCaches(cacheFixture);
  await platform.saveProvider({
    id: "key-fixture",
    name: "Fake",
    baseUrl: "https://fixture.invalid",
    modelId: "fixture",
    enabled: true,
    apiKey: "sk-fixture-only-abcd",
  });
  const saved = Object.fromEntries(
    Object.entries(storage).filter(
      ([key]) => !key.startsWith("cachalot:page:") && !key.startsWith("cachalot:setting:preview:"),
    ),
  );
  const before = await cacheRepository.usage();
  assert.deepEqual(
    before.map((row) => row.entries),
    [2, 1, 2, 3, 1],
  );
  assert.equal(
    before[0].bytes,
    cacheFixture.analyses
      .slice(0, 2)
      .reduce((sum, page) => sum + new TextEncoder().encode(JSON.stringify(page)).byteLength, 0),
  );
  assert.equal(before[4].candidates, 2);
  await cacheRepository.clear("layout");
  const afterLayout = await cacheRepository.usage();
  assert.equal(afterLayout[1].bytes, 0);
  assert.deepEqual(
    afterLayout.filter((row) => row.kind !== "layout"),
    before.filter((row) => row.kind !== "layout"),
  );
  for (const kind of CACHE_KINDS) {
    await cacheRepository.clear(kind);
    await cacheRepository.clear(kind);
  }
  assert.ok((await cacheRepository.usage()).every((row) => row.entries === 0 && row.bytes === 0));
  assert.deepEqual(Object.fromEntries(Object.entries(storage)), saved);
  assert.deepEqual([...(await platform.loadPdf("cache-paper"))], cacheFixture.pdfBytes);
  assert.equal((await platform.listMessages("thread"))[0].content, "Keep my chat");
  assert.equal(
    (await platform.listMessages("thread"))[0].images?.[0].dataUrl,
    cacheFixture.preview,
  );
  assert.equal(await platform.revealProviderKey("key-fixture"), "sk-fixture-only-abcd");
  // Regeneration through the real repositories is still possible after clear.
  await analysisRepository.put(cacheFixture.analyses[0]);
  await formulaRepository.put(cacheFixture.formula);
  await platform.savePageText("cache-paper", 1, "regenerated");
  await platform.savePageText("cache-paper", 2, "");
  assert.equal((await cacheRepository.usage())[0].entries, 1);
  assert.equal(
    (await cacheRepository.usage())[2].entries,
    2,
    "Empty/scanned pages are still indexed records",
  );
  assert.deepEqual(
    await formulaRepository.get(cacheFixture.formula.asset.formula),
    cacheFixture.formula,
  );
  await assert.rejects(cacheRepository.clear("providers" as never), /Unknown cache kind/);
});

test("clear waits for committed writes and rejects late results from older generations", async () => {
  const generation = cacheGeneration("formulas");
  let releaseWrite!: () => void;
  const waiting = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  const events: string[] = [];
  const first = writeCache("formulas", generation, async () => {
    events.push("write");
    await waiting;
    events.push("committed");
  });
  // Let this write start before invalidation; clear must wait for it to finish.
  await Promise.resolve();
  const clear = clearCacheRecords("formulas", async () => {
    events.push("cleared");
  });
  const late = formulaRepository.put(cacheFixture.formula, generation);
  const fresh = writeCache("formulas", cacheGeneration("formulas"), async () => {
    events.push("fresh");
  });
  releaseWrite();
  await Promise.all([first, clear, late, fresh]);
  assert.deepEqual(events, ["write", "committed", "cleared", "fresh"]);
  // A failed operation must not poison the queue or misreport a later clear.
  await assert.rejects(
    clearCacheRecords("native", async () => {
      throw new Error("fixture failure");
    }),
  );
  await cacheRepository.clear("native");
  assert.equal((await cacheRepository.usage())[0].entries, 0);
});
