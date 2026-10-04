import { invoke } from "@tauri-apps/api/core";
import { platform } from "./platform";
import type { FormulaAsset, FormulaFragment } from "../domain/analysis";
import { openCacheStore } from "./cache-stores";
import { cacheGeneration, writeCache } from "./cache-writes";

export interface FormulaRecord {
  documentId: string;
  id: string;
  asset: FormulaAsset;
  /** OCR results are unverified reading aids, scoped to exact model and prompt. */
  candidates: Record<string, string>;
}
const key = (f: FormulaFragment) => `formula-assets:v1:${f.id}`;
async function database(): Promise<IDBDatabase> {
  return (await openCacheStore("formulas")).db;
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("assets", mode),
        request = action(tx.objectStore("assets"));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || request.error);
      tx.onerror = () => undefined;
    });
  } finally {
    db.close();
  }
}

export const formulaRepository = {
  async get(formula: FormulaFragment): Promise<FormulaRecord | null> {
    const stored = platform.native
      ? await invoke<string | null>("get_page_analysis", {
          documentId: formula.documentId,
          page: formula.page,
          cacheKey: key(formula),
        })
      : await transaction("readonly", (store) => store.get([formula.documentId, formula.id]));
    if (!stored) return null;
    try {
      const record: FormulaRecord = typeof stored === "string" ? JSON.parse(stored) : stored;
      // Coordinates and extraction rules may change while the glyph range stays stable.
      return record.id === formula.id &&
        record.documentId === formula.documentId &&
        record.asset.formula.page === formula.page &&
        record.asset.formula.factsKey === formula.factsKey &&
        JSON.stringify(record.asset.formula.box) === JSON.stringify(formula.box)
        ? record
        : null;
    } catch {
      return null;
    }
  },
  async put(record: FormulaRecord, generation = cacheGeneration("formulas")): Promise<void> {
    await writeCache("formulas", generation, async () => {
      if (platform.native)
        return invoke("save_page_analysis", {
          documentId: record.documentId,
          page: record.asset.formula.page,
          cacheKey: key(record.asset.formula),
          // The shared SQLite endpoint validates this versioned envelope too.
          content: JSON.stringify({
            ...record,
            schemaVersion: 1,
            page: record.asset.formula.page,
            cacheKey: key(record.asset.formula),
          }),
        });
      await transaction("readwrite", (store) => store.put(record));
    });
  },
  async removeDocument(id: string): Promise<void> {
    if (platform.native) return; // page_analysis foreign key cascades.
    const db = await database();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("assets", "readwrite");
        const cursor = tx
          .objectStore("assets")
          .index("documentId")
          .openKeyCursor(IDBKeyRange.only(id));
        cursor.onsuccess = () => {
          if (cursor.result) {
            tx.objectStore("assets").delete(cursor.result.primaryKey);
            cursor.result.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};
