import { MAX_PACKAGE_BYTES, type ExtensionPackage } from "./package";
/** ZIP processing stays off the reader thread and is terminated on cancellation or timeout. */
export async function readLocalPackage(
  file: File,
  signal?: AbortSignal,
): Promise<ExtensionPackage> {
  if (file.size > MAX_PACKAGE_BYTES) throw new Error("Extension package exceeds 16 MiB");
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const worker = new Worker(new URL("./package.worker.ts", import.meta.url), { type: "module" });
  let release = () => {};
  try {
    return await new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("Cancelled", "AbortError"));
      const timer = setTimeout(
        () => reject(new Error("Extension package inspection timed out")),
        15000,
      );
      release = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      };
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event) => {
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.value);
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(bytes, [bytes.buffer]);
    });
  } finally {
    release();
    worker.terminate();
  }
}
