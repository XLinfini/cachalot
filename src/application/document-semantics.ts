import type { ContentBlock, HeadingLevel, PageFacts } from "../domain/analysis";
import type {
  DocumentSection,
  DocumentSemantics,
  SemanticNode,
  SemanticPageView,
} from "../domain/document-semantics";
import { area, characterText, intersection, union } from "../domain/geometry";
import { DOCUMENT_SEMANTICS_KEY } from "../domain/model";
import type { PageSemanticFragment } from "./assemble-page-semantics";
import { nativeLatex } from "./formula-analysis";

const romanSection = /^[IVX]+[.)]?\s+\S/u;
const singleLine = (text: string) => text.replace(/\s+/gu, " ").trim();
type HeadingEvidence = Pick<ContentBlock, "kind" | "text" | "box" | "headingLevel">;

/** Full source headings supply evidence, including Roman sections on other
 * pages. Coincident title predictions are checked only on the same page. */
export function inferHeadingLevel(
  block: HeadingEvidence,
  local: HeadingEvidence[],
  all = local,
): HeadingLevel | undefined {
  if (block.kind !== "title" && block.kind !== "heading") return undefined;
  if (block.headingLevel) return block.headingLevel;
  if (
    block.kind === "title" ||
    local.some(
      (other) =>
        other.kind === "title" &&
        intersection(other.box, block.box) / Math.max(area(block.box), area(other.box)) > 0.9,
    )
  )
    return 1;
  const text = singleLine(block.text);
  const numbered = text.match(/^(\d+(?:\.\d+){0,4})[.)]?\s+\S/u);
  if (numbered) return Math.min(6, numbered[1].split(".").length + 1) as HeadingLevel;
  if (romanSection.test(text)) return 2;
  if (
    /^[A-Z][.)]\s+\S/u.test(text) ||
    (/^[A-Z]\s+\S/u.test(text) &&
      all.some((other) => other.kind === "heading" && romanSection.test(singleLine(other.text))))
  )
    return 3;
  return 2;
}

/** Page-local assembly feeds a single document snapshot. Missing layout pages
 * break structural continuity; arrival order never becomes reading order. */
export function buildDocumentSemantics(
  documentId: string,
  pageCount: number,
  fragments: PageSemanticFragment[],
  revision = 1,
): DocumentSemantics {
  const ordered = [...fragments].sort((a, b) => a.input.page - b.input.page);
  const inputs = ordered.map((fragment) => ({ ...fragment.input }));
  if (
    new Set(inputs.map((input) => input.page)).size !== inputs.length ||
    inputs.some((input) => input.page < 1 || input.page > pageCount) ||
    ordered.some((fragment) =>
      fragment.nodes.some((node) =>
        node.sources.some((source) => source.documentId !== documentId),
      ),
    )
  )
    throw new Error("Semantic inputs do not match the document");
  const factsPages = inputs.map((input) => input.page);
  const layoutPages = inputs.filter((input) => input.observationKey).map((input) => input.page);
  const missingPages = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (page) => !layoutPages.includes(page),
  );
  const complete = missingPages.length === 0;
  const nodes = ordered.flatMap((fragment) =>
    fragment.nodes.map((node) => ({ ...node, evidence: [...node.evidence] })),
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const readingOrder = ordered.flatMap((fragment) => fragment.readingOrder);
  const evidenceBlock = (node: SemanticNode): HeadingEvidence => ({
    ...node,
    box: node.sources[0].box,
  });
  const allHeadings = nodes
    .filter((node) => ["heading", "title"].includes(node.kind))
    .map(evidenceBlock);
  for (const fragment of ordered) {
    const local = fragment.nodes.map(evidenceBlock);
    for (const original of fragment.nodes) {
      const node = byId.get(original.id)!;
      node.headingLevel = inferHeadingLevel(evidenceBlock(node), local, allHeadings);
      if (node.headingLevel)
        node.evidence.push({ rule: "source-heading-numbering", confidence: 0.6 });
      if (node.headingLevel === 1) node.role = "document-title";
    }
  }

  const sections: DocumentSection[] = [];
  let stack: DocumentSection[] = [],
    previousPage = 0,
    abstract = false;
  for (const id of readingOrder) {
    const node = byId.get(id)!;
    const page = node.sources[0].page;
    if (page !== previousPage) {
      if (
        previousPage !== page - 1 ||
        !layoutPages.includes(previousPage) ||
        !layoutPages.includes(page)
      ) {
        stack = [];
        abstract = false;
      }
      previousPage = page;
    }
    if (node.headingLevel && node.text.trim()) {
      abstract = /^(?:abstract|摘要)[.:：]?$/iu.test(singleLine(node.text));
      if (abstract) node.role = "abstract";
      if (node.headingLevel > 1) {
        while (stack.length && stack.at(-1)!.level >= node.headingLevel) stack.pop();
        const section: DocumentSection = {
          id: `section-${node.id}`,
          headingId: node.id,
          level: node.headingLevel,
          parentId: stack.at(-1)?.id,
          nodeIds: [],
          status: complete ? "inferred" : "provisional",
        };
        sections.push(section);
        stack.push(section);
      } else stack = [];
    }
    if (
      node.kind === "paragraph" &&
      (abstract || /^(?:abstract|摘要)\s*[—–:：]/iu.test(node.text))
    ) {
      node.role = "abstract";
      node.evidence.push({ rule: "explicit-abstract-label", confidence: 0.8 });
    }
    if (stack.length) {
      node.sectionId = stack.at(-1)!.id;
      stack.at(-1)!.nodeIds.push(node.id);
    }
  }

  const relations = ordered.flatMap((fragment) => fragment.relations);
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1],
      next = ordered[index];
    if (
      next.input.page !== previous.input.page + 1 ||
      !previous.input.observationKey ||
      !next.input.observationKey
    )
      continue;
    const meaningful = (fragment: PageSemanticFragment) =>
      fragment.readingOrder
        .map((id) => byId.get(id)!)
        .filter(
          (node) =>
            !["header", "footer"].includes(node.kind) &&
            (node.text.trim() || ["formula", "figure", "table"].includes(node.kind)),
        );
    const last = meaningful(previous).at(-1),
      first = meaningful(next)[0];
    if (
      last?.kind === "paragraph" &&
      first?.kind === "paragraph" &&
      last.sources[0].box[3] > 0.72 &&
      first.sources[0].box[1] < 0.28 &&
      !/[.!?。！？:;：；]\s*$/u.test(last.text) &&
      /^\p{Ll}/u.test(first.text)
    ) {
      relations.push({
        kind: "continues",
        from: last.id,
        to: first.id,
        status: "candidate",
        evidence: [{ rule: "adjacent-page-unfinished-paragraph", confidence: 0.55 }],
      });
    }
  }
  return {
    schemaVersion: 1,
    kind: "document-semantics",
    documentId,
    cacheKey: DOCUMENT_SEMANTICS_KEY,
    revision,
    pageCount,
    inputs,
    coverage: { factsPages, layoutPages, missingPages, complete },
    nodes,
    formulas: ordered.flatMap((fragment) => fragment.formulas),
    readingOrder,
    sections,
    relations,
  };
}

/** A page view is always a projection of the document tree plus source facts.
 * Even a multi-page node exposes only its local source fragment here. */
export function projectSemanticPage(
  document: DocumentSemantics,
  facts: PageFacts,
): SemanticPageView {
  const input = document.inputs.find((input) => input.page === facts.page);
  if (document.documentId !== facts.documentId || input?.factsKey !== facts.cacheKey)
    throw new Error("Semantic snapshot does not match page facts");
  const blocks = document.nodes.flatMap<ContentBlock>((node) => {
    const sources = node.sources.filter(
      (source) => source.page === facts.page && source.factsKey === facts.cacheKey,
    );
    if (!sources.length) return [];
    const characterIndices = [...new Set(sources.flatMap((source) => source.characterIndices))];
    return [
      {
        id: node.id,
        kind: node.kind,
        box: union(sources.map((source) => source.box)),
        confidence: node.evidence[0]?.confidence || 0,
        text: characterText(facts.characters, new Set(characterIndices)),
        characterIndices,
        objectIds: [...new Set(sources.flatMap((source) => source.objectIds))],
        headingLevel: node.headingLevel,
        parentId: document.relations.find(
          (relation) => relation.kind === "panel-of" && relation.from === node.id,
        )?.to,
        captionId: document.relations.find(
          (relation) => relation.kind === "caption-of" && relation.to === node.id,
        )?.from,
      },
    ];
  });
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const readingOrder = document.readingOrder.filter((id) => byId.has(id));
  const formulas = document.formulas
    .filter(
      (formula) => formula.source.page === facts.page && formula.source.factsKey === facts.cacheKey,
    )
    .map((formula) => {
      const indices = new Set(formula.source.characterIndices);
      const characters = facts.characters.filter((character) => indices.has(character.index));
      const latex = formula.mode === "inline" ? nativeLatex(characters, facts.height) : null;
      return {
        id: formula.id,
        documentId: facts.documentId,
        factsKey: facts.cacheKey,
        page: facts.page,
        box: formula.source.box,
        pageWidth: facts.width,
        pageHeight: facts.height,
        blockId: formula.blockId,
        mode: formula.mode,
        characterIndices: formula.source.characterIndices,
        nativeText: characterText(facts.characters, indices),
        latex,
        recognition: latex ? ("native-candidate" as const) : ("unrecognized" as const),
        baseline: formula.baseline,
        emSize: formula.emSize,
      };
    });
  return {
    documentId: facts.documentId,
    page: facts.page,
    facts,
    document,
    stage: input.observationKey ? "layout" : "native",
    blocks,
    readingOrder,
    formulas,
    warnings: input.warnings,
    plainText: readingOrder
      .map((id) => byId.get(id)!)
      .filter((block) => !["figure", "header", "footer"].includes(block.kind))
      .map((block) => block.text)
      .filter(Boolean)
      .join("\n\n"),
  };
}
