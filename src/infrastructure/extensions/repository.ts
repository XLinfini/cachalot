import type { ExtensionPackage } from "./package";
/** Installed code is user data, isolated from regenerable PDF caches. Works in Tauri and browsers. */
export class ExtensionRepository {
  private async open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("cachalot-extensions", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("packages", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Extension storage is blocked"));
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
  }
  async list(): Promise<ExtensionPackage[]> {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction("packages", "readonly"),
          request = transaction.objectStore("packages").getAll();
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }
  async change(packages: ExtensionPackage[], remove: string[] = []): Promise<void> {
    const db = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("packages", "readwrite"),
          store = transaction.objectStore("packages");
        transaction.oncomplete = () => resolve();
        transaction.onabort = () =>
          reject(transaction.error || new Error("Extension storage transaction aborted"));
        transaction.onerror = () => reject(transaction.error);
        try {
          for (const id of remove) store.delete(id);
          for (const item of packages) store.put(item);
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      });
    } finally {
      db.close();
    }
  }
}
