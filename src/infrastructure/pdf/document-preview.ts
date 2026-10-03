import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { platform } from "../platform";
import { openCacheStore } from "../cache-stores";
import { cacheGeneration, writeCache } from "../cache-writes";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();
const key = (id: string) => `preview:v1:${id}`;

/** Keep browser covers out of localStorage's small shared quota. Native
 * settings already live in SQLite; browser payloads use IndexedDB. */
async function previewCache(
  action: "get" | "put" | "delete",
  id: string,
  image?: string,
): Promise<string | undefined> {
  if (platform.native) {
    if (action === "get") return (await platform.getSetting(key(id))) || undefined;
    await platform.setSetting(key(id), action === "put" ? image! : "");
    return undefined;
  }
  const { db } = await openCacheStore("previews");
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("previews", action === "get" ? "readonly" : "readwrite");
      const store = tx.objectStore("previews");
      const request =
        action === "get"
          ? store.get(key(id))
          : action === "put"
            ? store.put(image, key(id))
            : store.delete(key(id));
      let result: string | undefined;
      request.onsuccess = () => {
        if (action === "get") result = request.result;
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Small persistent first-page images. No Docling/PDFium session is needed.
 * Serial rendering avoids opening many large papers at once in the library. */
export function documentPreview(id: string): Promise<string> {
  const existing = pending.get(id);
  if (existing) return existing;
  const generation = cacheGeneration("previews");
  const work = queue.then(async () => {
    const stored = await previewCache("get", id);
    if (stored?.startsWith("data:image/")) return stored;
    const task = pdfjs.getDocument({ data: await platform.loadPdf(id) });
    try {
      const pdf = await task.promise;
      const page = await pdf.getPage(1);
      const size = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(260 / size.width, 320 / size.height) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      const image = canvas.toDataURL("image/webp", 0.85);
      canvas.width = canvas.height = 0;
      await writeCache("previews", generation, async () => { await previewCache("put", id, image); });
      return image;
    } finally {
      await task.destroy();
    }
  });
  queue = work.catch(() => undefined);
  pending.set(id, work);
  void work.then(
    () => pending.delete(id),
    () => pending.delete(id),
  );
  return work;
}

export async function removePreview(id: string): Promise<void> {
  await pending.get(id)?.catch(() => undefined);
  await previewCache("delete", id);
}
