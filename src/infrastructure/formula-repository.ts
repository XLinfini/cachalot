import { invoke } from "@tauri-apps/api/core";
import { platform } from "./platform";
import type { FormulaAsset, FormulaFragment } from "../domain/analysis";

export interface FormulaRecord {
  documentId: string;
  id: string;
  asset: FormulaAsset;
  /** OCR results are unverified reading aids, scoped to exact model and prompt. */
  candidates: Record<string, string>;
}
const key = (f: FormulaFragment) => `formula-assets:v1:${f.id}`;
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cachalot-formulas", 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore("assets", { keyPath: ["documentId", "id"] });
      store.createIndex("documentId", "documentId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
        JSON.stringify(record.asset.formula.box) === JSON.stringify(formula.box)
        ? record
        : null;
    } catch {
      return null;
    }
  },
  async put(record: FormulaRecord): Promise<void> {
    if (platform.native)
      return invoke("save_page_analysis", {
        documentId: record.documentId,
        page: record.asset.formula.page,
        cacheKey: key(record.asset.formula),
        content: JSON.stringify(record),
      });
    await transaction("readwrite", (store) => store.put(record));
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
