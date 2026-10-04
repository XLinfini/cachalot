import { message } from "../domain/messages";

/** Shared browser cache schemas. Never open user-data stores for cache clearing. */
const schemas = {
  analysis: {
    database: "cachalot-analysis",
    store: "pages",
    keyPath: ["documentId", "cacheKey", "page"],
  },
  semantics: {
    database: "cachalot-semantics",
    store: "documents",
    keyPath: ["documentId", "cacheKey"],
  },
  formulas: { database: "cachalot-formulas", store: "assets", keyPath: ["documentId", "id"] },
  previews: { database: "cachalot-previews", store: "previews", keyPath: undefined },
} as const;
export type CacheStore = keyof typeof schemas;
export async function openCacheStore(
  kind: CacheStore,
): Promise<{ db: IDBDatabase; store: string }> {
  const schema = schemas[kind];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(schema.database, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(
        schema.store,
        schema.keyPath ? { keyPath: [...schema.keyPath] } : undefined,
      );
      if (schema.keyPath) store.createIndex("documentId", "documentId");
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error(message("cacheBlocked")));
    };
  });
  return { db, store: schema.store };
}
