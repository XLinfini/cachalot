import wasmUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import type { Box } from "../../domain/analysis";
import type { PdfComposition, PdfPageInfo, PdfRegion } from "../../domain/document-workbench";
import type { PdfResource, PdfResourceRef } from "../../domain/pdf-resources";

export type PdfOperation =
  | { kind: "inspect"; bytes: Uint8Array }
  | { kind: "region"; bytes: Uint8Array; page: number; box: Box }
  | { kind: "resource"; bytes: Uint8Array; ref: PdfResourceRef }
  | { kind: "compose"; input: PdfComposition };
// Serialized computation avoids multiplying WASM heaps for large books. A
// cancellation kills only this operation's worker, never analysis or readers.
let queue = Promise.resolve();
function operation<T>(input: PdfOperation, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  input = structuredClone(input);
  const job = queue
    .catch(() => undefined)
    .then(
      () =>
        new Promise<T>((resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("Cancelled", "AbortError"));
            return;
          }
          const worker = new Worker(new URL("./operations.worker.ts", import.meta.url), {
            type: "module",
          });
          const finish = () => {
            signal?.removeEventListener("abort", abort);
            worker.terminate();
          };
          const abort = () => {
            finish();
            reject(new DOMException("Cancelled", "AbortError"));
          };
          signal?.addEventListener("abort", abort, { once: true });
          worker.onmessage = ({ data }) => {
            finish();
            data.error ? reject(new Error(data.error)) : resolve(data.value);
          };
          worker.onerror = () => {
            finish();
            reject(new Error("PDF worker failed"));
          };
          try {
            worker.postMessage({ wasmUrl, operation: input });
          } catch (error) {
            finish();
            reject(error);
          }
        }),
    );
  queue = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}
export const pdfOperations = {
  inspect: (bytes: Uint8Array, signal?: AbortSignal) =>
    operation<PdfPageInfo[]>({ kind: "inspect", bytes }, signal),
  exportRegion: (bytes: Uint8Array, page: number, box: Box, signal?: AbortSignal) =>
    operation<PdfRegion>({ kind: "region", bytes, page, box }, signal),
  compose: (input: PdfComposition, signal?: AbortSignal) =>
    operation<Uint8Array>({ kind: "compose", input }, signal),
  resolveResource: (bytes: Uint8Array, ref: PdfResourceRef, signal?: AbortSignal) =>
    operation<PdfResource>({ kind: "resource", bytes, ref }, signal),
};
