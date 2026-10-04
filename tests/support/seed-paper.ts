/** Populate the browser's PDF and analysis stores for a real-paper UI case.
 * Call after the page has loaded; each Playwright context remains isolated. */
import type { Page } from "@playwright/test";
import type { LayoutObservations } from "../../src/domain/analysis";
import type { SemanticPageView } from "../../src/domain/document-semantics";

export async function seedPaper(
  page: Page,
  input: {
    analyses: SemanticPageView[];
    observations: LayoutObservations[];
    bytes: number[];
    aliases?: string[];
  },
): Promise<void> {
  await page.evaluate(
    async ({ facts, observations, semantics, bytes, aliases }) => {
      const pdf = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("cachalot-pdfs", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("pdfs");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = pdf.transaction("pdfs", "readwrite");
          for (const id of aliases.length ? aliases : [facts[0].documentId])
            tx.objectStore("pdfs").put(new Uint8Array(bytes).buffer, id);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        pdf.close();
      }
      const cache = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("cachalot-analysis", 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("pages", {
            keyPath: ["documentId", "cacheKey", "page"],
          });
          store.createIndex("documentId", "documentId");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = cache.transaction("pages", "readwrite");
          for (const entry of [...facts, ...observations]) tx.objectStore("pages").put(entry);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        cache.close();
      }
      const documents = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("cachalot-semantics", 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("documents", {
            keyPath: ["documentId", "cacheKey"],
          });
          store.createIndex("documentId", "documentId");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = documents.transaction("documents", "readwrite");
          tx.objectStore("documents").put(semantics);
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        documents.close();
      }
    },
    {
      facts: input.analyses.map((view) => view.facts),
      observations: input.observations,
      semantics: input.analyses[0].document,
      bytes: input.bytes,
      aliases: input.aliases || [],
    },
  );
}
