import type { LayoutObservations, NativePage, PageFacts } from "../../domain/analysis";
import type { DocumentSemantics } from "../../domain/document-semantics";
import {
  DOCUMENT_SEMANTICS_KEY,
  LAYOUT_OBSERVATIONS_KEY,
  PAGE_FACTS_KEY,
} from "../../domain/model";

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";
const array = (value: unknown): value is unknown[] => Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= 0;
const box = (value: unknown): boolean => array(value) && value.length === 4 && value.every(finite);
const strings = (value: unknown): value is string[] =>
  array(value) && value.every((item) => typeof item === "string");
const indices = (value: unknown): value is number[] => array(value) && value.every(integer);
const blockKinds = new Set([
  "paragraph",
  "title",
  "heading",
  "caption",
  "figure",
  "table",
  "formula",
  "footnote",
  "header",
  "footer",
  "list",
  "code",
  "other",
]);

export function validNativePage(value: unknown, page: number): value is NativePage {
  return (
    object(value) &&
    value.page === page &&
    finite(value.width) &&
    value.width > 0 &&
    finite(value.height) &&
    value.height > 0 &&
    strings(value.warnings) &&
    array(value.characters) &&
    value.characters.every(
      (character) =>
        object(character) &&
        integer(character.index) &&
        typeof character.text === "string" &&
        box(character.box) &&
        finite(character.fontSize) &&
        typeof character.generated === "boolean" &&
        (character.emSize === undefined || finite(character.emSize)) &&
        (character.origin === undefined ||
          (array(character.origin) &&
            character.origin.length === 2 &&
            character.origin.every(finite))),
    ) &&
    array(value.objects) &&
    value.objects.every(
      (item) =>
        object(item) &&
        integer(item.id) &&
        box(item.box) &&
        ["text", "path", "image", "shading", "form", "unknown"].includes(String(item.kind)),
    )
  );
}
export function validPageFacts(
  value: unknown,
  documentId: string,
  page: number,
): value is PageFacts {
  return (
    object(value) &&
    value.schemaVersion === 1 &&
    value.kind === "page-facts" &&
    value.documentId === documentId &&
    value.cacheKey === PAGE_FACTS_KEY &&
    finite(value.extractedAt) &&
    !("blocks" in value) &&
    !("formulas" in value) &&
    validNativePage(value, page)
  );
}
export function validObservations(
  value: unknown,
  documentId: string,
  page: number,
): value is LayoutObservations {
  return (
    object(value) &&
    value.schemaVersion === 1 &&
    value.kind === "layout-observations" &&
    value.documentId === documentId &&
    value.page === page &&
    value.cacheKey === LAYOUT_OBSERVATIONS_KEY &&
    finite(value.observedAt) &&
    array(value.detections) &&
    value.detections.every(
      (detection) =>
        object(detection) &&
        blockKinds.has(String(detection.kind)) &&
        box(detection.box) &&
        finite(detection.confidence),
    )
  );
}
export function validDocumentSemantics(
  value: unknown,
  documentId: string,
  pageCount: number,
): value is DocumentSemantics {
  if (
    !object(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "document-semantics" ||
    value.documentId !== documentId ||
    value.cacheKey !== DOCUMENT_SEMANTICS_KEY ||
    value.pageCount !== pageCount ||
    !integer(value.revision) ||
    !array(value.inputs) ||
    !array(value.nodes) ||
    !array(value.formulas) ||
    !array(value.sections) ||
    !array(value.relations) ||
    !strings(value.readingOrder) ||
    !object(value.coverage)
  )
    return false;
  const pages = new Set<number>();
  for (const input of value.inputs) {
    if (
      !object(input) ||
      !integer(input.page) ||
      input.page < 1 ||
      input.page > pageCount ||
      pages.has(input.page) ||
      input.factsKey !== PAGE_FACTS_KEY ||
      (input.observationKey !== undefined && input.observationKey !== LAYOUT_OBSERVATIONS_KEY) ||
      !strings(input.warnings)
    )
      return false;
    pages.add(input.page);
  }
  const source = (ref: unknown): boolean =>
    object(ref) &&
    ref.documentId === documentId &&
    integer(ref.page) &&
    pages.has(ref.page) &&
    ref.factsKey === PAGE_FACTS_KEY &&
    box(ref.box) &&
    indices(ref.characterIndices) &&
    indices(ref.objectIds);
  const evidence = (items: unknown): boolean =>
    array(items) &&
    items.every((item) => object(item) && typeof item.rule === "string" && finite(item.confidence));
  const nodeIds = new Set<string>();
  for (const node of value.nodes) {
    if (
      !object(node) ||
      typeof node.id !== "string" ||
      nodeIds.has(node.id) ||
      !blockKinds.has(String(node.kind)) ||
      typeof node.text !== "string" ||
      !array(node.sources) ||
      !node.sources.length ||
      !node.sources.every(source) ||
      !array(node.content) ||
      !evidence(node.evidence) ||
      (node.headingLevel !== undefined &&
        (!integer(node.headingLevel) || node.headingLevel < 1 || node.headingLevel > 6))
    )
      return false;
    nodeIds.add(node.id);
  }
  const formulaIds = new Set<string>();
  for (const formula of value.formulas) {
    if (
      !object(formula) ||
      typeof formula.id !== "string" ||
      formulaIds.has(formula.id) ||
      !nodeIds.has(String(formula.blockId)) ||
      !["inline", "display"].includes(String(formula.mode)) ||
      !source(formula.source) ||
      !evidence(formula.evidence) ||
      "latex" in formula ||
      "recognition" in formula
    )
      return false;
    formulaIds.add(formula.id);
  }
  const sectionIds = new Set(
    value.sections.map((section) => (object(section) ? section.id : undefined)),
  );
  if (sectionIds.has(undefined) || sectionIds.size !== value.sections.length) return false;
  for (const node of value.nodes) {
    if (!object(node)) return false;
    if (node.sectionId !== undefined && !sectionIds.has(node.sectionId)) return false;
    if (
      !array(node.content) ||
      !node.content.every(
        (span) =>
          object(span) &&
          (span.kind === "formula"
            ? formulaIds.has(String(span.formulaId))
            : span.kind === "text" &&
              typeof span.text === "string" &&
              integer(span.sourceIndex) &&
              array(node.sources) &&
              span.sourceIndex < node.sources.length &&
              indices(span.characterIndices)),
      )
    )
      return false;
  }
  if (
    !value.sections.every(
      (section) =>
        object(section) &&
        typeof section.id === "string" &&
        nodeIds.has(String(section.headingId)) &&
        integer(section.level) &&
        section.level >= 1 &&
        section.level <= 6 &&
        strings(section.nodeIds) &&
        section.nodeIds.every((id) => nodeIds.has(id)) &&
        (section.parentId === undefined || sectionIds.has(section.parentId)) &&
        ["inferred", "provisional"].includes(String(section.status)),
    )
  )
    return false;
  for (const section of value.sections) {
    if (!object(section)) return false;
    const parent = value.sections.find(
      (parent) => object(parent) && parent.id === section.parentId,
    );
    if (
      section.parentId !== undefined &&
      (!object(parent) ||
        !finite(parent.level) ||
        !finite(section.level) ||
        parent.level >= section.level)
    )
      return false;
  }
  if (
    !value.relations.every(
      (relation) =>
        object(relation) &&
        nodeIds.has(String(relation.from)) &&
        nodeIds.has(String(relation.to)) &&
        ["caption-of", "panel-of", "continues"].includes(String(relation.kind)) &&
        ["inferred", "candidate"].includes(String(relation.status)) &&
        evidence(relation.evidence),
    )
  )
    return false;
  const layoutPages = value.inputs
    .filter((input) => object(input) && input.observationKey)
    .map((input) => (object(input) ? input.page : undefined));
  const expectedMissing = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
    (page) => !layoutPages.includes(page),
  );
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return (
    value.readingOrder.length === nodeIds.size &&
    new Set(value.readingOrder).size === nodeIds.size &&
    value.readingOrder.every((id) => nodeIds.has(id)) &&
    indices(value.coverage.factsPages) &&
    indices(value.coverage.layoutPages) &&
    indices(value.coverage.missingPages) &&
    same(value.coverage.factsPages, [...pages]) &&
    same(value.coverage.layoutPages, layoutPages) &&
    same(value.coverage.missingPages, expectedMissing) &&
    value.coverage.complete === (expectedMissing.length === 0)
  );
}

/** A structurally valid cache must still resolve every glyph/object anchor in
 * the actual loaded extraction before it can become the active snapshot. */
export function semanticSourcesResolve(document: DocumentSemantics, facts: PageFacts[]): boolean {
  const pages = new Map(
    facts.map((page) => [
      page.page,
      {
        page,
        characters: new Set(page.characters.map((character) => character.index)),
        objects: new Set(page.objects.map((object) => object.id)),
      },
    ]),
  );
  return [
    ...document.nodes.flatMap((node) => node.sources),
    ...document.formulas.map((formula) => formula.source),
  ].every((source) => {
    const native = pages.get(source.page);
    return (
      native?.page.documentId === source.documentId &&
      native.page.cacheKey === source.factsKey &&
      source.characterIndices.every((index) => native.characters.has(index)) &&
      source.objectIds.every((id) => native.objects.has(id))
    );
  });
}
