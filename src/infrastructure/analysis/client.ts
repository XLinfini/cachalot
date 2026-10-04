import { message } from "../../domain/messages";
import pdfiumUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { LAYOUT_MODEL } from "../../domain/model";
import type { Box, LayoutObservations, PageFacts } from "../../domain/analysis";
import type { AnalysisEngine, WorkerRequest, WorkerResponse, WorkerResults } from "./protocol";

type Request = WorkerRequest extends infer T
  ? T extends WorkerRequest
    ? Omit<T, "id">
    : never
  : never;

/** RPC transport. UI components must never import or manage the worker. */
export class AnalysisClient implements AnalysisEngine {
  private readonly worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {
    type: "module",
  });
  private sequence = 0;
  private readonly pending = new Map<
    number,
    {
      operation: keyof WorkerResults;
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
    }
  >();
  private disposed = false;
  get isDisposed(): boolean {
    return this.disposed;
  }

  constructor(onProgress: (message: string) => void) {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.kind === "progress") {
        onProgress(response.message);
        return;
      }
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.kind === "result" && response.operation === request.operation)
        request.resolve(response.result);
      else if (response.kind === "result")
        request.reject(new Error(message("analysisEngineError")));
      else request.reject(new Error(response.error));
    };
    this.worker.onerror = () => this.dispose(new Error(message("analysisEngineError")));
  }

  private request<K extends keyof WorkerResults>(
    request: Extract<Request, { kind: K }>,
    transfer: Transferable[] = [],
  ): Promise<WorkerResults[K]> {
    if (this.disposed)
      return Promise.reject(new DOMException(message("analysisStopped"), "AbortError"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        operation: request.kind,
        resolve: (value) => resolve(value as WorkerResults[K]),
        reject,
      });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  async open(documentId: string, bytes: Uint8Array): Promise<void> {
    const buffer = bytes.slice().buffer;
    const modelUrl = new URL(
      `${import.meta.env.BASE_URL}models/${LAYOUT_MODEL.fileName}`,
      window.location.href,
    ).href;
    await this.request({ kind: "open", documentId, bytes: buffer, pdfiumUrl, modelUrl }, [buffer]);
  }

  extract(page: number): Promise<PageFacts> {
    return this.request({ kind: "extract", page });
  }
  detect(page: number): Promise<LayoutObservations> {
    return this.request({ kind: "detect", page });
  }
  exportRegion(page: number, box: Box): Promise<Uint8Array> {
    return this.request({ kind: "export", page, box });
  }

  dispose(error: Error = new DOMException(message("analysisStopped"), "AbortError")): void {
    this.disposed = true;
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
