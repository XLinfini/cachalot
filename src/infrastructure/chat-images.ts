import type { ChatImage } from "../domain/records";

/** Browser image payloads use IndexedDB rather than localStorage's small quota.
 * Metadata stays with messages; image records follow message/thread deletion. */
export async function chatImages(action: "get" | "put" | "delete", id: string, images?: ChatImage[]): Promise<ChatImage[] | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cachalot-chat-images", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("images", action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("images");
      const request = action === "get" ? store.get(id) : action === "put" ? store.put(images, id) : store.delete(id);
      let result: ChatImage[] | undefined;
      request.onsuccess = () => { if (action === "get") result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
