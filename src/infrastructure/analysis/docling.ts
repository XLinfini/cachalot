import { message } from "../../domain/messages";
import * as ort from "onnxruntime-web/wasm";
import type { BlockKind, LayoutDetection } from "../../domain/analysis";
import { LAYOUT_MODEL } from "../../domain/model";

// Label order comes from config.json at LAYOUT_MODEL.revision, not UI strings.
const LABELS: BlockKind[] = ["caption", "footnote", "formula", "list", "footer", "header", "figure", "heading", "table", "paragraph", "title", "other", "code", "other", "other", "other", "other"];

/** Inference adapter, intentionally independent of the document viewer. */
export class DoclingLayout {
  private constructor(private readonly session: ort.InferenceSession) {}

  static async create(model: Uint8Array): Promise<DoclingLayout> {
    // One CPU WASM thread works without SharedArrayBuffer/cross-origin isolation,
    // including Safari. Every platform uses the same weights and precision.
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    if (session.inputNames.join(",") !== "images,orig_target_sizes" || session.outputNames.join(",") !== "labels,boxes,scores") {
      await session.release();
      throw new Error(message("modelInterface"));
    }
    return new DoclingLayout(session);
  }

  async detect(rgb: Uint8Array): Promise<LayoutDetection[]> {
    const size = LAYOUT_MODEL.inputSize;
    const pixels = size * size;
    if (rgb.length !== pixels * 3) throw new Error(message("modelImage"));
    const chw = new Uint8Array(rgb.length);
    for (let index = 0; index < pixels; index++) for (let channel = 0; channel < 3; channel++) chw[channel * pixels + index] = rgb[index * 3 + channel];
    // The pinned ONNX graph includes rescaling and detection postprocessing.
    // Do NOT normalize twice. orig_target_sizes uses [height, width].
    const images = new ort.Tensor("uint8", chw, [1, 3, size, size]);
    const sizes = new ort.Tensor("int64", BigInt64Array.from([BigInt(size), BigInt(size)]), [1, 2]);
    let output: ort.InferenceSession.ReturnType | undefined;
    try {
      output = await this.session.run({ images, orig_target_sizes: sizes });
      const detections: LayoutDetection[] = [];
      const labels = output.labels.data as BigInt64Array;
      const boxes = output.boxes.data as Float32Array;
      const scores = output.scores.data as Float32Array;
      for (let index = 0; index < scores.length; index++) {
        if (scores[index] < LAYOUT_MODEL.threshold) continue;
        const box = Array.from(boxes.slice(index * 4, index * 4 + 4), value => Math.max(0, Math.min(1, value / size))) as LayoutDetection["box"];
        if (!box.every(Number.isFinite) || box[2] <= box[0] || box[3] <= box[1]) continue;
        detections.push({ kind: LABELS[Number(labels[index])] || "other", box, confidence: scores[index] });
      }
      return detections.sort((a, b) => b.confidence - a.confidence);
    } finally {
      images.dispose(); sizes.dispose();
      if (output) for (const tensor of Object.values(output)) tensor.dispose();
    }
  }

  async dispose(): Promise<void> { await this.session.release(); }
}
