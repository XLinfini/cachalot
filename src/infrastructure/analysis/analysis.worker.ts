import { message } from "../../domain/messages";
import * as ort from "onnxruntime-web/wasm";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortModuleUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import { PdfiumDocument } from "./pdfium";
import { DoclingLayout } from "./docling";
import { createPageFacts } from "../../domain/page-facts";
import { LAYOUT_MODEL, LAYOUT_OBSERVATIONS_KEY } from "../../domain/model";
import type { WorkerRequest, WorkerResponse } from "./protocol";

ort.env.wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortModuleUrl };
let pdf: PdfiumDocument | undefined;
let layout: DoclingLayout | undefined;
let documentId = "";
let modelUrl = "";
const reply = (message: WorkerResponse) => self.postMessage(message);

async function getLayout(id: number): Promise<DoclingLayout> {
  if (layout) return layout;
  reply({ id, kind: "progress", message: message("loadingModel") });
  const response = await fetch(modelUrl);
  if (!response.ok || response.headers.get("content-type")?.includes("text/html"))
    throw new Error(message("modelUnavailable"));
  const model = new Uint8Array(await response.arrayBuffer());
  if (model.length !== LAYOUT_MODEL.size) throw new Error(message("modelIncomplete"));
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", model))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== LAYOUT_MODEL.sha256) throw new Error(message("modelChecksum"));
  layout = await DoclingLayout.create(model);
  return layout;
}

async function handle(request: WorkerRequest): Promise<void> {
  try {
    if (request.kind === "open") {
      if (!pdf) {
        const response = await fetch(request.pdfiumUrl);
        if (!response.ok) throw new Error(message("pdfEngineUnavailable"));
        pdf = await PdfiumDocument.create(await response.arrayBuffer());
      }
      documentId = request.documentId;
      modelUrl = request.modelUrl;
      reply({
        id: request.id,
        kind: "result",
        operation: "open",
        result: pdf.open(new Uint8Array(request.bytes)),
      });
      return;
    }
    if (!pdf) throw new Error(message("pdfNotOpen"));
    if (request.kind === "export") {
      reply({
        id: request.id,
        kind: "result",
        operation: "export",
        result: pdf.exportRegion(request.page, request.box),
      });
      return;
    }
    if (request.kind === "extract") {
      reply({
        id: request.id,
        kind: "result",
        operation: "extract",
        result: createPageFacts(documentId, pdf.extract(request.page, documentId)),
      });
      return;
    }
    const model = await getLayout(request.id);
    reply({
      id: request.id,
      kind: "progress",
      message: message("analyzingPage", { page: request.page }),
    });
    const detections = await model.detect(pdf.renderRgb(request.page, LAYOUT_MODEL.inputSize));
    reply({
      id: request.id,
      kind: "result",
      operation: "detect",
      result: {
        schemaVersion: 1,
        kind: "layout-observations",
        documentId,
        page: request.page,
        cacheKey: LAYOUT_OBSERVATIONS_KEY,
        detections,
        observedAt: Date.now(),
      },
    });
  } catch (error) {
    reply({
      id: request.id,
      kind: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Async ONNX inference yields. Serializing requests keeps borrowed PDFium
// handles valid; a document cannot be closed while another request uses it.
let queue = Promise.resolve();
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => handle(event.data));
};
