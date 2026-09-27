/**
 * Stable data contract shared by the worker, storage adapters and UI.
 * Coordinates are normalized [left, top, right, bottom] in the displayed page,
 * including its intrinsic rotation. They never contain CSS pixels or zoom.
 * Keep this module independent of React, Tauri and inference libraries.
 */
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
}

export interface LayoutDetection {
  kind: BlockKind;
  box: Box;
  confidence: number;
}

export interface ContentBlock extends LayoutDetection {
  id: string;
  text: string;
  characterIndices: number[];
  objectIds: number[];
  captionId?: string;
  /** Nested panel inside a larger figure; render the outer region only once. */
  parentId?: string;
}

export interface PageAnalysis {
  schemaVersion: 1;
  documentId: string;
  cacheKey: string;
  page: number;
  width: number;
  height: number;
  characters: PdfCharacter[];
  objects: PdfObject[];
  blocks: ContentBlock[];
  readingOrder: string[];
  plainText: string;
  warnings: string[];
  analyzedAt: number;
  formulas?: FormulaFragment[];
}

/** Source is authoritative for appearance. LaTeX is a reading aid, never a
 * replacement for the original glyphs/paths when reflowing or exporting. */
export interface FormulaFragment {
  id: string;
  documentId: string;
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

export interface TranslationResult {
  /** Stable formula references survive model translation and later reflow. */
  markdown: string;
  formulas: FormulaAsset[];
}

export type TranslationPhase = "preparing" | "translating";
export interface FormulaPreparationIssue {
  formulaId: string;
  reason: "request" | "invalid" | "characters" | "vision-unavailable";
  /** Transport errors are already credential-redacted by the platform adapter. */
  details?: string;
}
export interface PreparedTranslationSource {
  formulas: FormulaAsset[];
  issues: FormulaPreparationIssue[];
}

/** UI-neutral selection DTO. Image is a temporary preview, not a cached PDF. */
export interface SelectedRegion {
  documentId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  imageDataUrl: string;
  blockIds: string[];
  formulas?: FormulaFragment[];
}

export interface AnalysisProgress {
  phase: "loading" | "analyzing" | "ready" | "error";
  completed: number;
  total: number;
  // Language-neutral message() encoding, resolved only by the presentation layer.
  message: string;
}
