import { invoke, isTauri } from "@tauri-apps/api/core";
import type { DocumentSemantics } from "../../domain/document-semantics";
import { DOCUMENT_SEMANTICS_KEY } from "../../domain/model";
import { openCacheStore } from "../cache-stores";
import { cacheGeneration, writeCache } from "../cache-writes";
import { validDocumentSemantics } from "./validation";

const native = isTauri();
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const { db, store } = await openCacheStore("semantics");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode),
      request = action(tx.objectStore(store));
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error || request.error);
    };
  });
}
export const semanticsRepository = {
  async get(documentId: string, pageCount: number): Promise<DocumentSemantics | null> {
    const result = native
      ? await invoke<string | null>("get_document_semantics", {
          documentId,
          cacheKey: DOCUMENT_SEMANTICS_KEY,
        })
      : await transaction("readonly", (store) => store.get([documentId, DOCUMENT_SEMANTICS_KEY]));
    try {
      const parsed: unknown = typeof result === "string" ? JSON.parse(result) : result;
      return validDocumentSemantics(parsed, documentId, pageCount) ? parsed : null;
    } catch {
      return null;
    }
  },
  put(document: DocumentSemantics, generation = cacheGeneration("semantics")): Promise<void> {
    if (!validDocumentSemantics(document, document.documentId, document.pageCount))
      return Promise.reject(new Error("Invalid document semantics"));
    return writeCache("semantics", generation, async () => {
      if (native)
        return invoke("save_document_semantics", {
          documentId: document.documentId,
          cacheKey: document.cacheKey,
          content: JSON.stringify(document),
        });
      await transaction("readwrite", (store) => store.put(document));
    });
  },
  async deleteDocument(documentId: string): Promise<void> {
    if (native) return;
    const { db, store } = await openCacheStore("semantics");
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      const request = tx
        .objectStore(store)
        .index("documentId")
        .openKeyCursor(IDBKeyRange.only(documentId));
      request.onsuccess = () => {
        if (request.result) {
          tx.objectStore(store).delete(request.result.primaryKey);
          request.result.continue();
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
