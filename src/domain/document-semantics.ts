import type {
  BlockKind,
  Box,
  ContentBlock,
  FormulaFragment,
  HeadingLevel,
  PageFacts,
} from "./analysis";

/** Coordinates and indices address one exact extraction of the original PDF. */
export interface SourceRef {
  documentId: string;
  page: number;
  factsKey: string;
  box: Box;
  characterIndices: number[];
  objectIds: number[];
}

export interface SemanticEvidence {
  rule: string;
  confidence: number;
  observationKey?: string;
}

export type ContentSpan =
  | { kind: "text"; text: string; sourceIndex: number; characterIndices: number[] }
  | { kind: "formula"; formulaId: string };

export interface SemanticNode {
  id: string;
  kind: BlockKind;
  text: string;
  sources: SourceRef[];
  content: ContentSpan[];
  evidence: SemanticEvidence[];
  headingLevel?: HeadingLevel;
  role?: "document-title" | "abstract";
  sectionId?: string;
}

/** Formula grouping is semantic. LaTeX/OCR candidates belong to reconstruction
 * resources or transient projections, never to the source document tree. */
export interface SemanticFormula {
  id: string;
  blockId: string;
  mode: "inline" | "display";
  source: SourceRef;
  baseline?: number;
  emSize?: number;
  evidence: SemanticEvidence[];
}

export interface SemanticRelation {
  kind: "caption-of" | "panel-of" | "continues";
  from: string;
  to: string;
  status: "inferred" | "candidate";
  evidence: SemanticEvidence[];
}

export interface DocumentSection {
  id: string;
  headingId: string;
  level: HeadingLevel;
  parentId?: string;
  nodeIds: string[];
  status: "inferred" | "provisional";
}

export interface SemanticPageInput {
  page: number;
  factsKey: string;
  observationKey?: string;
  warnings: string[];
}

/** The single authoritative structural interpretation, including page-local
 * structure. Snapshots are replaced, not mutated when background pages arrive. */
export interface DocumentSemantics {
  schemaVersion: 1;
  kind: "document-semantics";
  documentId: string;
  cacheKey: string;
  revision: number;
  pageCount: number;
  inputs: SemanticPageInput[];
  coverage: {
    factsPages: number[];
    layoutPages: number[];
    missingPages: number[];
    complete: boolean;
  };
  nodes: SemanticNode[];
  formulas: SemanticFormula[];
  readingOrder: string[];
  sections: DocumentSection[];
  relations: SemanticRelation[];
}

/** Transient UI/selection projection. Never persisted as another page tree. */
export interface SemanticPageView {
  documentId: string;
  page: number;
  facts: PageFacts;
  document: DocumentSemantics;
  stage: "native" | "layout";
  blocks: ContentBlock[];
  readingOrder: string[];
  formulas: FormulaFragment[];
  plainText: string;
  warnings: string[];
}

export interface AnalysisSnapshot {
  semantics: DocumentSemantics;
  pages: SemanticPageView[];
}
