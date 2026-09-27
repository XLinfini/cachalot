import { message } from "../domain/messages";

interface StoredKey {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

/** Browser credentials survive reloads and browser restarts. IndexedDB stores
 * ciphertext and a non-extractable Web Crypto key, never plaintext credentials.
 * This is browser-origin storage, not the desktop adapter's OS keyring: code
 * running in this origin can still use the encryption key. No memory fallback
 * is allowed, because reporting a successful save must mean a durable save.
 */
function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("cachalot-provider-keys", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("keys");
      request.result.createObjectStore("crypto");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Resolve only when the transaction commits, not when one request succeeds.
function transaction<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  run: (tx: IDBTransaction, result: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error || new Error("Credential transaction aborted"));
    try {
      run(tx, (result) => {
        value = result;
      });
    } catch (cause) {
      tx.abort();
      reject(cause);
    }
  });
}

async function inStore<T>(
  action: "read" | "write",
  run: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  let db: IDBDatabase | undefined;
  try {
    db = await openStore();
    return await run(db);
  } catch {
    throw new Error(message(action === "read" ? "browserKeyReadFailed" : "browserKeySaveFailed"));
  } finally {
    db?.close();
  }
}

async function masterKey(db: IDBDatabase): Promise<CryptoKey> {
  const candidate = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  // Concurrent tabs must claim the same master key. Keep the read and possible
  // insert in one transaction, with no awaited crypto work inside it.
  return transaction<CryptoKey>(db, ["crypto", "keys"], "readwrite", (tx, result) => {
    const store = tx.objectStore("crypto");
    const request = store.get("master");
    request.onsuccess = () => {
      const existing = request.result as CryptoKey | undefined;
      if (existing) {
        result(existing);
        return;
      }
      const records = tx.objectStore("keys").count();
      records.onsuccess = () => {
        // A missing master alongside ciphertext is damaged storage. Creating a
        // new master here would permanently strand all existing credentials.
        if (records.result > 0) {
          tx.abort();
          return;
        }
        store.put(candidate, "master");
        result(candidate);
      };
    };
  });
}

export const browserProviderKeys = {
  async get(id: string): Promise<string | null> {
    return inStore("read", async (db) => {
      const { stored, key } = await transaction<{ stored?: StoredKey; key?: CryptoKey }>(
        db,
        ["keys", "crypto"],
        "readonly",
        (tx, result) => {
          const record = tx.objectStore("keys").get(id);
          const master = tx.objectStore("crypto").get("master");
          const values: { stored?: StoredKey; key?: CryptoKey } = {};
          record.onsuccess = () => {
            values.stored = record.result;
          };
          master.onsuccess = () => {
            values.key = master.result;
          };
          result(values);
        },
      );
      if (!stored) return null;
      // Do not manufacture a new master for an existing encrypted credential.
      if (!key) throw new Error("Credential encryption key is missing");
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: stored.iv },
        key,
        stored.ciphertext,
      );
      return new TextDecoder().decode(plain);
    });
  },

  async has(id: string): Promise<boolean> {
    return inStore("read", (db) =>
      transaction<boolean>(db, ["keys"], "readonly", (tx, result) => {
        const request = tx.objectStore("keys").count(id);
        request.onsuccess = () => result(request.result > 0);
      }),
    );
  },

  async set(id: string, value: string): Promise<void> {
    await inStore("write", async (db) => {
      const key = await masterKey(db);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(value),
      );
      await transaction<void>(db, ["keys"], "readwrite", (tx) => {
        tx.objectStore("keys").put({ iv, ciphertext } satisfies StoredKey, id);
      });
    });
  },

  async delete(id: string): Promise<void> {
    await inStore("write", (db) =>
      transaction<void>(db, ["keys"], "readwrite", (tx) => {
        tx.objectStore("keys").delete(id);
      }),
    );
  },
};
