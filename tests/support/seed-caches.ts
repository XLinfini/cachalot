import type { CacheFixture } from "../fixtures/cache";

/** Browser-standard fixture seeding, shared by fake-indexeddb and Playwright.
 * Self-contained so it can be passed directly to page.evaluate. */
export async function seedCaches(input: CacheFixture): Promise<void> {
  async function store(name: string, store: string, keyPath?: string[]) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        const created = request.result.createObjectStore(store, keyPath ? { keyPath } : undefined);
        if (keyPath) created.createIndex("documentId", "documentId");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return db;
  }
  async function put(
    name: string,
    objectStore: string,
    values: Array<[unknown, IDBValidKey?]>,
    keyPath?: string[],
  ) {
    const db = await store(name, objectStore, keyPath);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(objectStore, "readwrite");
        for (const [value, key] of values) tx.objectStore(objectStore).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  await put(
    "cachalot-analysis",
    "pages",
    input.analyses.map((page) => [page]),
    ["documentId", "cacheKey", "page"],
  );
  await put("cachalot-semantics", "documents", [[input.semantics]], ["documentId", "cacheKey"]);
  await put("cachalot-formulas", "assets", [[input.formula]], ["documentId", "id"]);
  await put("cachalot-previews", "previews", [
    [input.preview, "preview:v1:cache-paper"],
    [input.preview, "preview:v0:old-paper"],
  ]);
  await put("cachalot-pdfs", "pdfs", [[new Uint8Array(input.pdfBytes).buffer, "cache-paper"]]);
  const chatImage = {
    id: "image",
    name: "fixture.gif",
    mimeType: "image/gif",
    dataUrl: input.preview,
  };
  await put("cachalot-chat-images", "images", [[[chatImage], "chat-message"]]);
  localStorage.setItem(
    "cachalot:documents",
    JSON.stringify([
      {
        id: "cache-paper",
        title: "Cache fixture paper",
        fileName: "cache.pdf",
        pageCount: 1,
        currentPage: 1,
        starred: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
  localStorage.setItem("cachalot:categories", JSON.stringify({ categories: [], assignments: {} }));
  localStorage.setItem(
    "cachalot:threads",
    JSON.stringify([
      { id: "thread", documentId: "cache-paper", title: "Saved chat", createdAt: 1, updatedAt: 1 },
    ]),
  );
  localStorage.setItem(
    "cachalot:messages",
    JSON.stringify([
      {
        id: "chat-message",
        threadId: "thread",
        role: "user",
        content: "Keep my chat",
        images: [{ ...chatImage, dataUrl: "" }],
        createdAt: 1,
      },
    ]),
  );
  localStorage.setItem("cachalot:setting:addedModels:p", '[{"id":"test-model"}]');
  localStorage.setItem("cachalot:setting:formulaOcrModel", '"off"');
  localStorage.setItem("cachalot:setting:translationPrompt", "Keep this prompt");
  localStorage.setItem("cachalot:page:cache-paper:1", "中文 x = 1");
  localStorage.setItem("cachalot:page:other-paper:2", "another page");
  localStorage.setItem("cachalot:setting:preview:v0:legacy-paper", input.preview);
}
