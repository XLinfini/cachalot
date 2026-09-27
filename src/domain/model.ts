/** All platforms use this exact FP32 ONNX artifact. Never point at `main`. */
export const LAYOUT_MODEL = {
  id: "docling-heron",
  revision: "40bde044036bb181c130ddf6c51792187268748f",
  sha256: "59c81a3a2923042d85034ffc487f8f47e4854117e879aef89b2b9f728fb4922a",
  size: 171220471,
  fileName: "docling-heron.onnx",
  inputSize: 640,
  threshold: 0.45,
  license: "Apache-2.0",
} as const;

export const MODEL_URL = `https://huggingface.co/docling-project/docling-layout-heron-onnx/resolve/${LAYOUT_MODEL.revision}/model.onnx`;

/** Bump whenever geometry, text assignment or reading-order rules change. */
export const ANALYSIS_CACHE_KEY = `schema1:pdfium2.15.1:heron-${LAYOUT_MODEL.sha256}:rules3-formulas2:threshold-${LAYOUT_MODEL.threshold}`;
export const NATIVE_CACHE_KEY = "schema1:pdfium2.15.1:native-rules2-metrics";
