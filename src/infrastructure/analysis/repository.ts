import { message } from "../../domain/messages";
import { invoke, isTauri } from "@tauri-apps/api/core";
import type { PageAnalysis } from "../../domain/analysis";

const native = isTauri();

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cachalot-analysis", 1);
    request.onupgradeneeded = () => {
      const pages = request.result.createObjectStore("pages", { keyPath: ["documentId", "cacheKey", "page"] });
      pages.createIndex("documentId", "documentId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pages", mode);
    const request = action(tx.objectStore("pages"));
    // Resolve only after commit, not request success. Closing the app between
    // request success and commit must never report an unpersisted page as saved.
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onabort = () => { db.close(); reject(tx.error || request.error || new Error(message("cacheWriteFailed"))); };
    tx.onerror = () => undefined; // onabort handles the final error once.
  });
}

export const analysisRepository = {
  async get(documentId: string, page: number, cacheKey: string): Promise<PageAnalysis | null> {
    const result = native ? await invoke<string | null>("get_page_analysis", { documentId, page, cacheKey })
      : await transaction("readonly", store => store.get([documentId, cacheKey, page]));
    if (!result) return null;
    try {
      const parsed: PageAnalysis = typeof result === "string" ? JSON.parse(result) : result;
      return parsed.schemaVersion === 1 && parsed.documentId === documentId && parsed.cacheKey === cacheKey && parsed.page === page
        && Array.isArray(parsed.characters) && Array.isArray(parsed.blocks) && Array.isArray(parsed.readingOrder) ? parsed : null;
    } catch { return null; }
  },
  async put(analysis: PageAnalysis): Promise<void> {
    if (native) return invoke("save_page_analysis", { documentId: analysis.documentId, page: analysis.page, cacheKey: analysis.cacheKey, content: JSON.stringify(analysis) });
    await transaction("readwrite", store => store.put(analysis));
  },
  async deleteDocument(documentId: string): Promise<void> {
    if (native) return; // SQLite foreign-key cascade deletes all versions.
    const db = await database();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("pages", "readwrite");
      const cursor = tx.objectStore("pages").index("documentId").openKeyCursor(IDBKeyRange.only(documentId));
      cursor.onsuccess = () => { if (cursor.result) { tx.objectStore("pages").delete(cursor.result.primaryKey); cursor.result.continue(); } };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    });
  },
};
