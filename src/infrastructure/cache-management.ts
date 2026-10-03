import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  CACHE_KINDS,
  analysisCacheKind,
  emptyCacheUsage,
  type CacheKind,
  type CacheUsage,
} from "../domain/cache";
import { openCacheStore, type CacheStore } from "./cache-stores";
import { clearCacheRecords, waitForCacheWrites } from "./cache-writes";

const native = isTauri();
const encoder = new TextEncoder();
const bytes = (value: unknown): number =>
  encoder.encode(typeof value === "string" ? value : JSON.stringify(value)).byteLength;
async function scan(
  kind: CacheStore,
  mode: IDBTransactionMode,
  visit: (cursor: IDBCursorWithValue) => void,
): Promise<void> {
  const { db, store } = await openCacheStore(kind);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, mode),
        request = tx.objectStore(store).openCursor();
      let failure: unknown;
      request.onsuccess = () => {
        if (!request.result) return;
        try {
          visit(request.result);
          request.result.continue();
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure || tx.error || request.error);
      tx.onerror = () => undefined;
    });
  } finally {
    db.close();
  }
}
/** Restrict localStorage operations to known derived-data prefixes. */
function localCacheKind(key: string): CacheKind | null {
  return key.startsWith("cachalot:page:")
    ? "pageText"
    : key.startsWith("cachalot:setting:preview:")
      ? "previews"
      : null;
}
export const cacheRepository = {
  async usage(): Promise<CacheUsage[]> {
    await waitForCacheWrites();
    if (native) return invoke("cache_usage");
    const usage = emptyCacheUsage();
    const add = (kind: CacheKind, value: unknown) => {
      const row = usage.find((row) => row.kind === kind)!;
      row.entries++;
      row.bytes += bytes(value);
      return row;
    };
    // Cursors avoid loading every large page into a second in-memory array.
    await scan("analysis", "readonly", (cursor) => {
      const kind = analysisCacheKind(String(cursor.value.cacheKey));
      const row = add(kind, cursor.value);
      if (kind === "formulas") row.candidates += Object.keys(cursor.value.candidates || {}).length;
    });
    await scan("previews", "readonly", (cursor) => add("previews", cursor.value));
    await scan("formulas", "readonly", (cursor) => {
      const row = add("formulas", cursor.value);
      row.candidates += Object.keys(cursor.value.candidates || {}).length;
    });
    for (const key of Object.keys(localStorage)) {
      const kind = localCacheKind(key),
        value = localStorage.getItem(key);
      if (kind && value !== null && (kind === "pageText" || value !== "")) add(kind, value);
    }
    return usage;
  },
  async clear(kind: CacheKind): Promise<void> {
    if (!CACHE_KINDS.includes(kind)) throw new Error("Unknown cache kind");
    await clearCacheRecords(kind, async () => {
      if (native) return invoke("clear_cache", { kind });
      if (kind === "native" || kind === "layout" || kind === "formulas") {
        await scan("analysis", "readwrite", (cursor) => {
          if (analysisCacheKind(String(cursor.value.cacheKey)) === kind) cursor.delete();
        });
      }
      if (kind === "previews" || kind === "formulas") {
        await scan(kind, "readwrite", (cursor) => {
          cursor.delete();
        });
      }
      for (const key of Object.keys(localStorage)) {
        if (localCacheKind(key) === kind) localStorage.removeItem(key);
      }
    });
  },
};
