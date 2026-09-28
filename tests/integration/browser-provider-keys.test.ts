import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { browserProviderKeys as keys } from "../../src/infrastructure/browser-provider-keys";
import { parseMessage } from "../../src/domain/messages";

test("durable credentials support concurrent tabs, replacement and deletion", async () => {
  const first = "sk-fixture-only-first-abcd";
  const second = "opaque-fixture-second-wxyz";
  await Promise.all([keys.set("first", first), keys.set("second", second)]);
  assert.equal(await keys.get("first"), first);
  assert.equal(await keys.get("second"), second);
  assert.equal(await keys.has("first"), true);

  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("cachalot-provider-keys", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const inspect = () =>
      new Promise<{ key: CryptoKey; stored: { ciphertext: ArrayBuffer; iv: Uint8Array } }>(
        (resolve, reject) => {
          const tx = db.transaction(["keys", "crypto"]);
          const key = tx.objectStore("crypto").get("master");
          const stored = tx.objectStore("keys").get("first");
          tx.oncomplete = () => resolve({ key: key.result, stored: stored.result });
          tx.onabort = () => reject(tx.error);
        },
      );
    const before = await inspect();
    assert.equal(before.key.extractable, false);
    await assert.rejects(() => crypto.subtle.exportKey("raw", before.key));
    assert.ok(!new TextDecoder().decode(before.stored.ciphertext).includes(first));
    await keys.set("first", second);
    assert.equal(await keys.get("first"), second);
    assert.notDeepEqual((await inspect()).stored.iv, before.stored.iv);

    await keys.delete("first");
    assert.equal(await keys.has("first"), false);
    assert.equal(await keys.get("first"), null);
    assert.equal(await keys.get("second"), second);

    // Corrupted/missing encryption state must surface a read error, not silently
    // overwrite the master and make existing credentials appear to be absent.
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("crypto", "readwrite");
      tx.objectStore("crypto").delete("master");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    await assert.rejects(
      () => keys.get("second"),
      (cause: unknown) => {
        assert.equal(parseMessage(String(cause))?.code, "browserKeyReadFailed");
        return true;
      },
    );
    await assert.rejects(
      () => keys.set("new", "fixture-only"),
      (cause: unknown) => {
        assert.equal(parseMessage(String(cause))?.code, "browserKeySaveFailed");
        return true;
      },
    );
  } finally {
    db.close();
    await keys.delete("second");
  }
});

test("unavailable browser storage cannot report a successful credential save", async () => {
  const factory = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        throw new DOMException("Storage denied", "SecurityError");
      },
    },
  });
  try {
    await assert.rejects(
      () => keys.set("blocked", "fixture-only"),
      (cause: unknown) => {
        assert.equal(parseMessage(String(cause))?.code, "browserKeySaveFailed");
        return true;
      },
    );
  } finally {
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
  }
  assert.equal(await keys.has("blocked"), false);
});
