import type {
  BlockKind,
  Box,
  FormulaAsset,
  FormulaFragment,
  FormulaPreparationIssue,
  HeadingLevel,
  ReaderSelection,
} from "../../sdk";
export interface SelectedTextBlock {
  id: string;
  kind: BlockKind;
  text: string;
  headingLevel?: HeadingLevel;
  partial: boolean;
}
export interface TranslationResult {
  /** Stable formula references survive model translation and later reflow. */
  markdown: string;
  formulas: FormulaAsset[];
}

export type TranslationPhase = "preparing" | "translating";
export interface PreparedTranslationSource {
  formulas: FormulaAsset[];
  issues: FormulaPreparationIssue[];
}

/** UI-neutral selection DTO. Image is a temporary preview, not a cached PDF. */
export interface SelectedRegion extends ReaderSelection {
  blockIds: string[];
  blocks?: SelectedTextBlock[];
  formulas?: FormulaFragment[];
  source?: SelectionSource;
  context?: TranslationContext;
  /** Complete semantic units accepted by rectangle selection. */
  units?: SelectionUnit[];
}

export interface SelectionUnit {
  id: string;
  kind: BlockKind;
  box: Box;
}

/** Exact output scope, independently of the broader context used to translate. */
export interface SelectionSource {
  factsKey: string;
  semanticsKey: string;
  semanticRevision: number;
  characterIndices: number[];
}

export interface TranslationContext {
  semanticRevision: number;
  complete: boolean;
  title?: string;
  abstract?: string;
  sectionPath: string[];
  passages: { nodeId: string; pages: number[]; text: string }[];
}
