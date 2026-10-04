import { message } from "../../domain/messages";
import type {
  ContentBlock,
  LayoutObservations,
  PageFacts,
  PdfCharacter,
} from "../../domain/analysis";
import type {
  ContentSpan,
  SemanticFormula,
  SemanticNode,
  SemanticPageInput,
  SemanticRelation,
  SourceRef,
} from "../../domain/document-semantics";
import { area, characterText, containsCenter, intersection, union } from "../../domain/geometry";
import { analyzeFormulas } from "./formulas";

/** Column-aware heuristic. Full-width headings/figures divide the page into bands. */
export function readingOrder(blocks: ContentBlock[]): string[] {
  if (blocks.length < 2) return blocks.map((b) => b.id);
  const spans = blocks
    .filter((b) => b.box[2] - b.box[0] > 0.65)
    .sort((a, b) => a.box[1] - b.box[1]);
  if (spans.length) {
    let rest = blocks.filter((b) => !spans.includes(b));
    const result: string[] = [];
    for (const span of spans) {
      const before = rest.filter(
        (b) => (b.box[1] + b.box[3]) / 2 < (span.box[1] + span.box[3]) / 2,
      );
      result.push(...readingOrder(before), span.id);
      rest = rest.filter((b) => !before.includes(b));
    }
    return [...result, ...readingOrder(rest)];
  }
  const xIntervals = blocks.map((b) => [b.box[0], b.box[2]]).sort((a, b) => a[0] - b[0]);
  let right = xIntervals[0][1];
  let gap = 0;
  let split = 0;
  for (const interval of xIntervals.slice(1)) {
    if (interval[0] - right > gap) {
      gap = interval[0] - right;
      split = (interval[0] + right) / 2;
    }
    right = Math.max(right, interval[1]);
  }
  if (gap > 0.015) {
    const left = blocks.filter((b) => (b.box[0] + b.box[2]) / 2 < split);
    const right = blocks.filter((b) => !left.includes(b));
    if (left.length && right.length) return [...readingOrder(left), ...readingOrder(right)];
  }
  return [...blocks].sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]).map((b) => b.id);
}

/** Internal builder input, not a separately persisted authoritative page tree. */
export interface PageSemanticFragment {
  input: SemanticPageInput;
  nodes: SemanticNode[];
  formulas: SemanticFormula[];
  readingOrder: string[];
  relations: SemanticRelation[];
}

export function assemblePageSemantics(
  native: PageFacts,
  observations?: LayoutObservations,
): PageSemanticFragment {
  if (
    observations &&
    (observations.documentId !== native.documentId || observations.page !== native.page)
  )
    throw new Error("Layout observations do not match page facts");
  const detections = observations?.detections || [];
  // Remove duplicate predictions of the same category. Overlapping figure/text
  // regions are retained and resolved during character ownership below.
  const unique = detections.filter(
    (detection, index) =>
      !detections
        .slice(0, index)
        .some(
          (other) =>
            other.kind === detection.kind &&
            intersection(other.box, detection.box) /
              (area(other.box) + area(detection.box) - intersection(other.box, detection.box)) >
              0.65,
        ),
  );
  const blocks: ContentBlock[] = unique.map((detection, index) => ({
    ...detection,
    id: `p${native.page}-b${index}`,
    text: "",
    characterIndices: [],
    objectIds: [],
  }));
  const unassigned: PdfCharacter[] = [];
  const priority = (block: ContentBlock) =>
    ["figure", "table"].includes(block.kind) ? 0 : block.kind === "formula" ? 1 : 2;
  for (const character of native.characters) {
    if (!area(character.box) || /^\s+$/u.test(character.text)) continue;
    const owner = blocks
      .filter((block) => containsCenter(block.box, character.box))
      .sort((a, b) => priority(a) - priority(b) || area(a.box) - area(b.box))[0];
    if (owner) owner.characterIndices.push(character.index);
    else unassigned.push(character);
  }
  // Preserve missed text instead of silently dropping it. Each native line is
  // a conservative fallback block with confidence=0, visible to future review UI.
  const lines: PdfCharacter[][] = [];
  for (const character of unassigned) {
    const last = lines.at(-1);
    if (
      last &&
      Math.abs(last[0].box[1] - character.box[1]) <
        Math.max(0.004, (character.box[3] - character.box[1]) / 2) &&
      character.box[0] - last.at(-1)!.box[2] < 0.025
    )
      last.push(character);
    else lines.push([character]);
  }
  for (const line of lines)
    blocks.push({
      id: `p${native.page}-fallback${blocks.length}`,
      kind: "paragraph",
      box: union(line.map((c) => c.box)),
      confidence: 0,
      text: "",
      characterIndices: line.map((c) => c.index),
      objectIds: [],
    });
  for (const block of blocks) {
    block.text = characterText(native.characters, new Set(block.characterIndices));
    block.objectIds = native.objects
      .filter((object) => containsCenter(block.box, object.box))
      .map((object) => object.id);
  }
  // Heron can detect a whole multi-panel figure and its individual panels.
  // Keep those relationships explicit so a later reflow/export can render the
  // outer crop once instead of duplicating overlapping figures.
  const visuals = blocks.filter((b) => ["figure", "table"].includes(b.kind));
  for (const visual of visuals) {
    const parent = visuals
      .filter(
        (other) =>
          other !== visual &&
          area(other.box) > area(visual.box) * 1.2 &&
          intersection(other.box, visual.box) / area(visual.box) > 0.95,
      )
      .sort((a, b) => area(a.box) - area(b.box))[0];
    if (parent) visual.parentId = parent.id;
  }
  for (const figure of visuals.filter((b) => !b.parentId)) {
    const captions = blocks.filter(
      (b) =>
        b.kind === "caption" &&
        Math.abs((b.box[0] + b.box[2] - figure.box[0] - figure.box[2]) / 2) < 0.3 &&
        b.box[1] >= figure.box[3] - 0.015 &&
        b.box[1] - figure.box[3] < 0.08,
    );
    const caption = captions.sort(
      (a, b) => Math.abs(a.box[1] - figure.box[3]) - Math.abs(b.box[1] - figure.box[3]),
    )[0];
    if (caption) figure.captionId = caption.id;
  }
  const order = readingOrder(blocks);
  const warnings = [...native.warnings];
  if (!native.characters.length) warnings.push(message("noNativeText"));
  if (detections.length && unassigned.length)
    warnings.push(message("unassignedCharacters", { count: unassigned.length }));
  const formulas = analyzeFormulas(native, blocks);
  const source = (block: ContentBlock): SourceRef => ({
    documentId: native.documentId,
    page: native.page,
    factsKey: native.cacheKey,
    box: block.box,
    characterIndices: block.characterIndices,
    objectIds: block.objectIds,
  });
  const nodes = blocks.map<SemanticNode>((block) => ({
    id: block.id,
    kind: block.kind,
    text: block.text,
    sources: [source(block)],
    content: contentSpans(
      native,
      block,
      formulas.filter((formula) => formula.blockId === block.id),
    ),
    evidence: [
      {
        rule: block.confidence ? "layout-character-ownership" : "native-line-fallback",
        confidence: block.confidence,
        observationKey: observations?.cacheKey,
      },
    ],
    headingLevel: block.headingLevel,
  }));
  const relations: SemanticRelation[] = blocks.flatMap((block) => [
    ...(block.parentId
      ? [
          {
            kind: "panel-of" as const,
            from: block.id,
            to: block.parentId,
            status: "inferred" as const,
            evidence: [{ rule: "geometric-containment", confidence: 0.95 }],
          },
        ]
      : []),
    ...(block.captionId
      ? [
          {
            kind: "caption-of" as const,
            from: block.captionId,
            to: block.id,
            status: "inferred" as const,
            evidence: [{ rule: "nearby-aligned-caption", confidence: 0.6 }],
          },
        ]
      : []),
  ]);
  return {
    input: {
      page: native.page,
      factsKey: native.cacheKey,
      observationKey: observations?.cacheKey,
      warnings,
    },
    nodes,
    formulas,
    readingOrder: order,
    relations,
  };
}

function contentSpans(
  page: PageFacts,
  block: ContentBlock,
  formulas: SemanticFormula[],
): ContentSpan[] {
  if (block.kind === "formula")
    return formulas.map((formula) => ({ kind: "formula", formulaId: formula.id }));
  const spans: ContentSpan[] = [];
  let remaining = block.characterIndices;
  const appendText = (indices: number[]) => {
    const text = characterText(page.characters, new Set(indices));
    if (text) spans.push({ kind: "text", text, sourceIndex: 0, characterIndices: indices });
  };
  for (const formula of [...formulas].sort(
    (a, b) => a.source.characterIndices[0] - b.source.characterIndices[0],
  )) {
    const first = formula.source.characterIndices[0],
      last = formula.source.characterIndices.at(-1)!;
    appendText(remaining.filter((index) => index < first));
    spans.push({ kind: "formula", formulaId: formula.id });
    remaining = remaining.filter((index) => index > last);
  }
  appendText(remaining);
  return spans;
}
