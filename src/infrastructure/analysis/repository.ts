import { message, parseMessage } from "../../domain/messages";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { LayoutObservations, PageFacts } from "../../domain/analysis";
import { LEGACY_ANALYSIS_KEYS, LAYOUT_OBSERVATIONS_KEY, PAGE_FACTS_KEY } from "../../domain/model";
import { createPageFacts } from "../../domain/page-facts";
import { openCacheStore } from "../cache-stores";
import { cacheGeneration, writeCache } from "../cache-writes";
import { validNativePage, validObservations, validPageFacts } from "./validation";

const native = isTauri();
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const { db, store } = await openCacheStore("analysis");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode),
      request = action(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || request.error || new Error(message("cacheWriteFailed")));
    };
    tx.onerror = () => undefined;
  });
}
async function read(documentId: string, page: number, cacheKey: string): Promise<unknown> {
  const result = native
    ? await invoke<string | null>("get_page_analysis", { documentId, page, cacheKey })
    : await transaction("readonly", (store) => store.get([documentId, cacheKey, page]));
  try {
    return typeof result === "string" ? JSON.parse(result) : result;
  } catch {
    return null;
  }
}
async function put(value: PageFacts | LayoutObservations, generation: number): Promise<void> {
  await writeCache(value.kind === "page-facts" ? "native" : "layout", generation, async () => {
    if (native)
      return invoke("save_page_analysis", {
        documentId: value.documentId,
        page: value.page,
        cacheKey: value.cacheKey,
        content: JSON.stringify(value),
      });
    await transaction("readwrite", (store) => store.put(value));
  });
}
export const analysisRepository = {
  async getFacts(documentId: string, page: number): Promise<PageFacts | null> {
    const result = await read(documentId, page, PAGE_FACTS_KEY);
    return validPageFacts(result, documentId, page) ? result : null;
  },
  async getLegacyFacts(documentId: string, page: number): Promise<PageFacts | null> {
    for (const key of LEGACY_ANALYSIS_KEYS) {
      const result = await read(documentId, page, key);
      if (
        validNativePage(result, page) &&
        "schemaVersion" in result &&
        result.schemaVersion === 1 &&
        "documentId" in result &&
        result.documentId === documentId &&
        "cacheKey" in result &&
        result.cacheKey === key
      )
        // These exact legacy PDFium versions emit only unmappedCharacters at
        // extraction time. Layout/fallback warnings do not migrate into facts.
        return createPageFacts(
          documentId,
          {
            ...result,
            warnings: result.warnings.filter(
              (warning) => parseMessage(warning)?.code === "unmappedCharacters",
            ),
          },
          "analyzedAt" in result && typeof result.analyzedAt === "number"
            ? result.analyzedAt
            : Date.now(),
        );
    }
    return null;
  },
  putFacts(facts: PageFacts, generation = cacheGeneration("native")): Promise<void> {
    if (!validPageFacts(facts, facts.documentId, facts.page))
      return Promise.reject(new Error("Invalid page facts"));
    return put(facts, generation);
  },
  async getObservations(documentId: string, page: number): Promise<LayoutObservations | null> {
    const result = await read(documentId, page, LAYOUT_OBSERVATIONS_KEY);
    return validObservations(result, documentId, page) ? result : null;
  },
  putObservations(
    observations: LayoutObservations,
    generation = cacheGeneration("layout"),
  ): Promise<void> {
    if (!validObservations(observations, observations.documentId, observations.page))
      return Promise.reject(new Error("Invalid layout observations"));
    return put(observations, generation);
  },
  async deleteDocument(documentId: string): Promise<void> {
    if (native) return;
    const { db, store } = await openCacheStore("analysis");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const cursor = tx
        .objectStore(store)
        .index("documentId")
        .openKeyCursor(IDBKeyRange.only(documentId));
      cursor.onsuccess = () => {
        if (cursor.result) {
          tx.objectStore(store).delete(cursor.result.primaryKey);
          cursor.result.continue();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  },
};
