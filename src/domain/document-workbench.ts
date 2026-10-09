import type { Box, PageFacts, LayoutObservations } from "./analysis";
import type { DocumentSemantics, SemanticPageView, SourceRef } from "./document-semantics";
import type { DocumentRecord } from "./records";
import type { PdfResourceRef, PdfResource } from "./pdf-resources";

export interface DocumentAnalysisProgress {
  phase: "facts" | "layout";
  completed: number;
  total: number;
}
export interface DocumentSnapshot {
  document: DocumentRecord;
  level: "facts" | "layout";
  semantics: DocumentSemantics;
  facts: PageFacts[];
}
/** A source lease survives closing or switching reader panes. Closing it is idempotent. */
export interface DocumentHandle {
  readonly document: DocumentRecord;
  readPdf(signal?: AbortSignal): Promise<Uint8Array>;
  readResource(ref: PdfResourceRef, signal?: AbortSignal): Promise<PdfResource>;
  getPageFacts(page: number): Promise<PageFacts>;
  getLayoutObservations(page: number): Promise<LayoutObservations | null>;
  getSemanticPage(page: number): Promise<SemanticPageView>;
  getDocumentSemantics(): Promise<DocumentSemantics>;
  analyze(options?: {
    level?: "facts" | "layout";
    signal?: AbortSignal;
    onProgress?: (progress: DocumentAnalysisProgress) => void;
  }): Promise<DocumentSnapshot>;
  close(): Promise<void>;
}
export interface Artifact {
  id: string;
  name: string;
  mediaType: string;
  sourceDocumentId?: string;
  byteLength: number;
  createdAt: number;
  updatedAt: number;
}
export interface ArtifactInput {
  /** Stable IDs allow atomic replacement of checkpoints and rendered files. */
  id: string;
  name: string;
  mediaType: string;
  sourceDocumentId?: string;
  bytes: Uint8Array;
}
export interface PdfPageInfo {
  page: number;
  width: number;
  height: number;
}
export interface PdfRegion {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Visual crop only: PDF resources can still contain content outside the region. */
  contentIsolation: "visual-crop";
}
export interface PdfPageSource {
  source: number;
  page: number;
}
export interface PdfOverlay extends PdfPageSource {
  /** Destination in displayed-page normalized coordinates. Defaults to the entire page. */
  box?: Box;
}
export interface PdfComposition {
  /** Sources are original PDFs or independently typeset overlay PDFs. */
  sources: Uint8Array[];
  pages: {
    /** Omit to make a blank page with width/height in PDF points. */
    source?: PdfPageSource;
    width?: number;
    height?: number;
    /** Exact source references. Partial/nested text objects are rejected, never broadly erased. */
    removeText?: SourceRef[];
    overlays?: PdfOverlay[];
  }[];
}
export interface ReaderAnchor {
  page: number;
  /** Displayed page fraction at the reading line, independent of zoom and viewport pixels. */
  fraction: number;
}
export interface PdfAlignment {
  id: string;
  original: { page: number; box: Box };
  derived: { page: number; box: Box }[];
}
export interface PdfComparisonOptions {
  id: string;
  documentId: string;
  /** Any owned PDF artifact; no required semantic relationship to documentId. */
  artifactId: string;
  title: string;
  alignment?: PdfAlignment[];
  /** Defaults to true only when explicit alignment is supplied. */
  synchronized?: boolean;
}
export interface PdfComparisonHandle {
  readonly id: string;
  update(options: { alignment?: PdfAlignment[]; synchronized?: boolean }): Promise<void>;
  reveal(side: "original" | "derived", anchor: ReaderAnchor): Promise<void>;
  close(): Promise<void>;
}
