import { message } from "../../domain/messages";
import pdfiumUrl from "@embedpdf/pdfium/pdfium.wasm?url";
import { LAYOUT_MODEL } from "../../domain/model";
import type { Box, PageAnalysis } from "../../domain/analysis";
import type { WorkerRequest, WorkerResponse } from "./protocol";

type Request = WorkerRequest extends infer T ? T extends WorkerRequest ? Omit<T, "id"> : never : never;

/** RPC transport. UI components must never import or manage the worker. */
export class AnalysisClient {
  private readonly worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
  private sequence = 0;
  private readonly pending = new Map<number, { resolve: (value: PageAnalysis | number | Uint8Array) => void; reject: (reason: Error) => void }>();
  private disposed = false;
  get isDisposed(): boolean { return this.disposed; }

  constructor(onProgress: (message: string) => void) {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.kind === "progress") { onProgress(response.message); return; }
      const request = this.pending.get(response.id);
      if (!request) return;
      this.pending.delete(response.id);
      if (response.kind === "result") request.resolve(response.result);
      else request.reject(new Error(response.error));
    };
    this.worker.onerror = () => this.dispose(new Error(message("analysisEngineError")));
  }

  private request(request: Request, transfer: Transferable[] = []): Promise<PageAnalysis | number | Uint8Array> {
    if (this.disposed) return Promise.reject(new DOMException(message("analysisStopped"), "AbortError"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...request, id }, transfer);
    });
  }

  async open(documentId: string, bytes: Uint8Array): Promise<void> {
    const buffer = bytes.slice().buffer;
    const modelUrl = new URL(`${import.meta.env.BASE_URL}models/${LAYOUT_MODEL.fileName}`, window.location.href).href;
    await this.request({ kind: "open", documentId, bytes: buffer, pdfiumUrl, modelUrl }, [buffer]);
  }

  async extract(page: number): Promise<PageAnalysis> { return await this.request({ kind: "extract", page }) as PageAnalysis; }
  async analyze(page: number, native?: PageAnalysis): Promise<PageAnalysis> { return await this.request({ kind: "analyze", page, native }) as PageAnalysis; }
  async exportRegion(page: number, box: Box): Promise<Uint8Array> { return await this.request({ kind: "export", page, box }) as Uint8Array; }

  dispose(error: Error = new DOMException(message("analysisStopped"), "AbortError")): void {
    this.disposed = true;
    this.worker.terminate();
    for (const request of this.pending.values()) request.reject(error);
    this.pending.clear();
  }
}
