/**
 * Stable data contract shared by the worker, storage adapters and UI.
 * Coordinates are normalized [left, top, right, bottom] in the displayed page,
 * including its intrinsic rotation. They never contain CSS pixels or zoom.
 * Keep this module independent of React, Tauri and inference libraries.
 */
import type { PdfMatrix, PdfPageGraphics } from "./pdf-resources";
export type Box = [number, number, number, number];
export type BlockKind =
  | "paragraph"
  | "title"
  | "heading"
  | "caption"
  | "figure"
  | "table"
  | "formula"
  | "footnote"
  | "header"
  | "footer"
  | "list"
  | "code"
  | "other";

export interface PdfCharacter {
  index: number;
  text: string;
  box: Box;
  fontSize: number;
  generated: boolean;
  /** Displayed baseline and effective em size, including PDF text matrices. */
  origin?: [number, number];
  emSize?: number;
  fontName?: string;
  italic?: boolean;
  /** Physical source object and raw baseline/matrix; absent on generated separators. */
  objectPath?: number[];
  pdfOrigin?: [number, number];
  matrix?: PdfMatrix;
}

export interface PdfObject {
  id: number;
  kind: "text" | "path" | "image" | "shading" | "form" | "unknown";
  box: Box;
}

/** PDFium output before semantic layout inference. */
export interface NativePage {
  page: number;
  width: number;
  height: number;
  characters: PdfCharacter[];
  objects: PdfObject[];
  warnings: string[];
  graphics?: PdfPageGraphics;
}

/** Source facts only. documentId is the PDF content hash; cacheKey fixes the
 * extractor and coordinate contract. Semantic inference never rewrites these. */
export interface PageFacts extends NativePage {
  schemaVersion: 2;
  kind: "page-facts";
  documentId: string;
  cacheKey: string;
  extractedAt: number;
  graphics: PdfPageGraphics;
}

export interface LayoutDetection {
  kind: BlockKind;
  box: Box;
  confidence: number;
}

/** Model predictions, not accepted document roles or assembled paragraphs. */
export interface LayoutObservations {
  schemaVersion: 1;
  kind: "layout-observations";
  documentId: string;
  cacheKey: string;
  page: number;
  detections: LayoutDetection[];
  observedAt: number;
}

export interface ContentBlock extends LayoutDetection {
  id: string;
  text: string;
  characterIndices: number[];
  objectIds: number[];
  captionId?: string;
  /** Nested panel inside a larger figure; render the outer region only once. */
  parentId?: string;
  /** Assigned by the document semantic builder, before selection. */
  headingLevel?: HeadingLevel;
}

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
/** Original glyphs/paths remain available for comparison and faithful export.
 * Reconstructed source and translation can render the same LaTeX candidate;
 * syntax/character checks do not prove mathematical correctness. */
export interface FormulaFragment {
  id: string;
  documentId: string;
  /** Exact extraction contract for source/candidate cache validation. */
  factsKey?: string;
  page: number;
  box: Box;
  mode: "inline" | "display";
  pageWidth: number;
  pageHeight: number;
  blockId: string;
  characterIndices: number[];
  nativeText: string;
  /** Hydrated from the cached page when selecting, including older page caches.
   * Unicode identifies glyphs; geometry supplies evidence for 2D reconstruction. */
  characters?: PdfCharacter[];
  latex: string | null;
  recognition: "native-candidate" | "model-candidate" | "unrecognized";
  baseline?: number;
  emSize?: number;
  partial?: boolean;
}

export interface FormulaAsset {
  formula: FormulaFragment;
  imageDataUrl: string;
  width: number;
  height: number;
  /** Lossless preview scale relative to PDF points, independent of reader zoom. */
  scale: number;
}

export interface FormulaPreparationIssue {
  formulaId: string;
  reason: "request" | "invalid" | "characters" | "vision-unavailable";
  details?: string;
}

export interface AnalysisProgress {
  phase: "loading" | "analyzing" | "ready" | "error";
  completed: number;
  total: number;
  // Language-neutral message() encoding, resolved only by the presentation layer.
  message: string;
}
