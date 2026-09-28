/** Populate the browser's PDF and analysis stores for a real-paper UI case.
 * Call after the page has loaded; each Playwright context remains isolated. */
import type { Page } from "@playwright/test";
import type { PageAnalysis } from "../../src/domain/analysis";
import { ANALYSIS_CACHE_KEY } from "../../src/domain/model";

export async function seedPaper(
  page: Page,
  input: { analyses: PageAnalysis[]; bytes: number[]; aliases?: string[] },
): Promise<void> {
  await page.evaluate(
    async ({ analyses, bytes, aliases, key }) => {
      const pdf = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("cachalot-pdfs", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("pdfs");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = pdf.transaction("pdfs", "readwrite");
          for (const id of aliases.length ? aliases : [analyses[0].documentId])
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
          for (const entry of analyses) tx.objectStore("pages").put({ ...entry, cacheKey: key });
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        cache.close();
      }
    },
    { ...input, aliases: input.aliases || [], key: ANALYSIS_CACHE_KEY },
  );
}
