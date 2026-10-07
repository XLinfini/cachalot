import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import "fake-indexeddb/auto";
import { DocumentAnalysisSession } from "../../src/application/document-analysis/session";
import { openDocumentHandle } from "../../src/application/document-analysis";
import type { AnalysisSnapshot } from "../../src/domain/document-semantics";
import type { AnalysisEngine } from "../../src/infrastructure/analysis/protocol";
import type { DocumentRecord } from "../../src/domain/records";
import { analysisRepository } from "../../src/infrastructure/analysis/repository";
import { semanticsRepository } from "../../src/infrastructure/analysis/semantics-repository";
import { cacheRepository } from "../../src/infrastructure/cache-management";
import { CACHE_KINDS } from "../../src/domain/cache";
import { LEGACY_ANALYSIS_KEYS } from "../../src/domain/model";
import { message } from "../../src/domain/messages";
import { openCacheStore } from "../../src/infrastructure/cache-stores";
import { semanticFixture } from "../fixtures/document-semantics";

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
const document: DocumentRecord = {
  id: "semantic-paper",
  title: "Fixture",
  fileName: "fixture.pdf",
  pageCount: 2,
  currentPage: 1,
  starred: false,
  createdAt: 1,
  updatedAt: 1,
};
const fixtures = [
  semanticFixture(1, [{ kind: "heading", text: "II Methods", box: [0.1, 0.1, 0.9, 0.14] }]),
  semanticFixture(2, [{ kind: "heading", text: "A Method", box: [0.1, 0.1, 0.9, 0.14] }]),
];
function engine(calls: string[], detect?: (page: number) => Promise<void>): AnalysisEngine {
  return {
    isDisposed: false,
    async open() {
      calls.push("open");
    },
    async extract(page) {
      calls.push(`extract:${page}`);
      return fixtures[page - 1].facts;
    },
    async detect(page) {
      calls.push(`detect:${page}`);
      await detect?.(page);
      return fixtures[page - 1].observations;
    },
    dispose() {
      calls.push("dispose");
    },
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  for (const kind of CACHE_KINDS) await cacheRepository.clear(kind);
});
test("job document handles provide complete detached snapshots and remain independent of reader disposal", async () => {
  const calls: string[] = [];
  const bytes = new Uint8Array([1, 2, 3]);
  const handle = await openDocumentHandle(document.id, {
    list: async () => [document],
    loadPdf: async () => bytes,
    createSession: (record, input) =>
      new DocumentAnalysisSession(
        record,
        input,
        () => undefined,
        () => undefined,
        () => engine(calls),
      ),
  });
  assert.equal((await handle.getDocumentSemantics()).coverage.complete, false);
  const read = await handle.readPdf();
  read[0] = 99;
  assert.deepEqual(await handle.readPdf(), bytes);
  const phases: string[] = [];
  const snapshot = await handle.analyze({
    onProgress: (item) => {
      phases.push(`${item.phase}:${item.completed}`);
    },
  });
  assert.equal(snapshot.semantics.coverage.complete, true);
  assert.equal(snapshot.facts.length, 2);
  assert.deepEqual(phases, ["facts:1", "facts:2", "layout:1", "layout:2"]);
  snapshot.semantics.nodes.length = 0;
  assert.ok((await handle.getDocumentSemantics()).nodes.length > 0);
  await handle.close();
  await handle.close();
  assert.equal(calls.filter((call) => call === "dispose").length, 1, "closing is idempotent");
  await assert.rejects(handle.getPageFacts(1), { name: "AbortError" });
  await assert.rejects(
    openDocumentHandle("missing", { list: async () => [], loadPdf: async () => bytes }),
    /not found/,
  );
});
test("cancelled full analysis closes its lease and resumes completed source stages in another handle", async () => {
  const calls: string[] = [],
    controller = new AbortController();
  const ports = {
    list: async () => [document],
    loadPdf: async () => new Uint8Array(),
    createSession: (record: DocumentRecord, input: Uint8Array) =>
      new DocumentAnalysisSession(
        record,
        input,
        () => undefined,
        () => undefined,
        () => engine(calls),
      ),
  };
  const handle = await openDocumentHandle(document.id, ports);
  await assert.rejects(
    handle.analyze({
      signal: controller.signal,
      onProgress: (item) => {
        if (item.phase === "facts" && item.completed === 1) controller.abort();
      },
    }),
    { name: "AbortError" },
  );
  assert.ok(calls.includes("dispose"));
  await assert.rejects(handle.readPdf(), { name: "AbortError" });
  calls.length = 0;
  const resumed = await openDocumentHandle(document.id, ports);
  assert.equal((await resumed.analyze()).semantics.coverage.complete, true);
  assert.ok(!calls.includes("extract:1"));
  await resumed.close();
});

test("facts extraction is independent; cached partial snapshots restore without loading the worker", async () => {
  const calls: string[] = [],
    snapshots: AnalysisSnapshot[] = [];
  const session = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    (snapshot) => snapshots.push(snapshot),
    () => undefined,
    () => engine(calls),
  );
  await session.getPageFacts(2);
  assert.deepEqual(calls, ["open", "extract:2"]);
  assert.equal("blocks" in (await analysisRepository.getFacts(document.id, 2))!, false);
  assert.deepEqual(snapshots.at(-1)!.semantics.coverage.layoutPages, []);
  await session.getSemanticPage(2);
  assert.deepEqual(snapshots.at(-1)!.semantics.coverage.missingPages, [1]);
  session.dispose();
  const reopenedCalls: string[] = [];
  const reopened = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () => engine(reopenedCalls),
  );
  assert.equal((await reopened.getSemanticPage(2)).stage, "layout");
  assert.deepEqual(reopenedCalls, []);
  await reopened.getSemanticPage(1);
  assert.equal((await reopened.getSemanticPage(2)).blocks[0].headingLevel, 3);
  assert.deepEqual(reopenedCalls, ["open", "extract:1", "detect:1"]);
  reopened.dispose();
});

test("clearing semantic rules reuses facts and observations; clearing observations reruns only detection", async () => {
  const first = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () => engine([]),
  );
  await first.start(1);
  first.dispose();
  await cacheRepository.clear("semantics");
  const reuse: string[] = [];
  const rebuilt = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () => engine(reuse),
  );
  await rebuilt.start(1);
  assert.deepEqual(reuse, []);
  assert.equal((await semanticsRepository.get(document.id, 2))?.coverage.complete, true);
  rebuilt.dispose();
  await cacheRepository.clear("layout");
  const detection: string[] = [];
  const refreshed = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () => engine(detection),
  );
  await refreshed.getSemanticPage(2);
  assert.deepEqual(detection, ["open", "detect:2"]);
  assert.deepEqual((await refreshed.getDocumentSemantics()).coverage.layoutPages, [2]);
  refreshed.dispose();
});

test("in-flight results cannot repopulate cleared fact, observation, semantic or text caches", async () => {
  const started = deferred(),
    release = deferred();
  const session = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () =>
      engine([], async () => {
        started.resolve();
        await release.promise;
      }),
  );
  const pending = session.getSemanticPage(1);
  await started.promise;
  for (const kind of ["native", "layout", "semantics", "pageText"] as const)
    await cacheRepository.clear(kind);
  release.resolve();
  assert.equal((await pending).stage, "layout");
  assert.equal(await analysisRepository.getFacts(document.id, 1), null);
  assert.equal(await analysisRepository.getObservations(document.id, 1), null);
  assert.equal(await semanticsRepository.get(document.id, 2), null);
  assert.equal(storage["cachalot:page:semantic-paper:1"], undefined);
  session.dispose();
});

test("disposing during inference prevents late callbacks and writes; model failures remain retryable", async () => {
  const started = deferred(),
    release = deferred(),
    snapshots: AnalysisSnapshot[] = [];
  const session = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    (snapshot) => snapshots.push(snapshot),
    () => undefined,
    () =>
      engine([], async () => {
        started.resolve();
        await release.promise;
      }),
  );
  const pending = session.getSemanticPage(1);
  await started.promise;
  const count = snapshots.length;
  session.dispose();
  release.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(snapshots.length, count);
  assert.equal(await analysisRepository.getObservations(document.id, 1), null);
  let fail = true;
  const calls: string[] = [];
  const retry = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () =>
      engine(calls, async () => {
        if (fail) {
          fail = false;
          throw new Error("fixture model failure");
        }
      }),
  );
  await assert.rejects(retry.getSemanticPage(1), /fixture model failure/);
  assert.equal((await retry.getSemanticPage(1)).stage, "layout");
  assert.deepEqual(calls, ["open", "detect:1", "detect:1"]);
  retry.dispose();
});

test("known legacy caches migrate only source facts; assembled blocks never masquerade as raw predictions", async () => {
  const { db, store } = await openCacheStore("analysis");
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put({
      ...fixtures[0].facts,
      schemaVersion: 1,
      cacheKey: LEGACY_ANALYSIS_KEYS[0],
      warnings: [
        message("unmappedCharacters", { count: 1 }),
        message("unassignedCharacters", { count: 2 }),
      ],
      blocks: [{ kind: "figure", text: "Wrong legacy interpretation" }],
      readingOrder: ["old"],
      analyzedAt: 7,
    });
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  db.close();
  const calls: string[] = [];
  const session = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () => engine(calls),
  );
  const facts = await session.getPageFacts(1);
  assert.deepEqual(calls, []);
  assert.equal("blocks" in facts, false);
  assert.equal(facts.extractedAt, 7);
  assert.deepEqual(facts.warnings, [message("unmappedCharacters", { count: 1 })]);
  assert.equal(await analysisRepository.getObservations(document.id, 1), null);
  await session.getSemanticPage(1);
  assert.deepEqual(calls, ["open", "detect:1"]);
  session.dispose();
});

test("concurrent requests share one replacement engine after a worker terminates", async () => {
  const started = deferred(),
    release = deferred();
  let disposed = false,
    factories = 0;
  const original = {
    ...engine([]),
    get isDisposed() {
      return disposed;
    },
    dispose() {
      disposed = true;
    },
  };
  const getObservations = analysisRepository.getObservations;
  analysisRepository.getObservations = async () => null;
  const session = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    async () => {
      factories++;
      if (factories === 1) return original;
      started.resolve();
      await release.promise;
      return engine([]);
    },
  );
  try {
    await session.getPageFacts(1);
    original.dispose();
    const facts = session.getPageFacts(2);
    await started.promise;
    const semantic = session.getSemanticPage(1);
    // Drain settled cache/index promises while replacement creation is gated.
    await new Promise<void>((resolve) => setImmediate(resolve));
    release.resolve();
    await Promise.all([facts, semantic]);
    assert.equal(factories, 2, "two pending page jobs must share one new worker");
  } finally {
    release.resolve();
    session.dispose();
    analysisRepository.getObservations = getObservations;
  }
});

test("a transient cache-open failure does not make session initialization permanently rejected", async () => {
  const get = semanticsRepository.get;
  let fail = true;
  semanticsRepository.get = async (...args) => {
    if (fail) {
      fail = false;
      throw new Error("fixture cache-open failure");
    }
    return get(...args);
  };
  const session = new DocumentAnalysisSession(
    document,
    new Uint8Array(),
    () => undefined,
    () => undefined,
    () => engine([]),
  );
  try {
    await assert.rejects(session.getPageFacts(1), /fixture cache-open failure/);
    assert.equal((await session.getPageFacts(1)).page, 1);
  } finally {
    session.dispose();
    semanticsRepository.get = get;
  }
});
