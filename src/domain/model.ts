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

/** Extraction, model observations and semantic rules have independent identity. */
export const PAGE_FACTS_KEY = "facts2:pdfium2.15.1:native-graphics1:resources1:coords1";
export const LAYOUT_OBSERVATIONS_KEY = `layout1:pdfium2.15.1:heron-${LAYOUT_MODEL.sha256}:threshold-${LAYOUT_MODEL.threshold}:render1:coords1`;
export const DOCUMENT_SEMANTICS_KEY = `document-semantics:v1:${PAGE_FACTS_KEY}:${LAYOUT_OBSERVATIONS_KEY}:assembly4-headings1-formulas2`;

/** Historical keys retained for diagnostics/tests. Their geometry cannot be
 * upgraded into graphics/resources; facts2 always re-extracts the source. */
export const LEGACY_ANALYSIS_KEYS = [
  `schema1:pdfium2.15.1:heron-${LAYOUT_MODEL.sha256}:rules3-formulas2:threshold-${LAYOUT_MODEL.threshold}`,
  "schema1:pdfium2.15.1:native-rules2-metrics",
] as const;
