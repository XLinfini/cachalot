import type { LayoutDetection, LayoutObservations, NativePage } from "../../src/domain/analysis";
import { createPageFacts } from "../../src/domain/page-facts";
import { LAYOUT_OBSERVATIONS_KEY } from "../../src/domain/model";
import { assemblePageSemantics } from "../../src/application/document-analysis/page-semantics";
import {
  buildDocumentSemantics,
  projectSemanticPage,
} from "../../src/application/document-analysis/document-semantics";

/** The real two-layer pipeline, with deterministic source/model timestamps. */
export function fixtureSources(
  documentId: string,
  native: NativePage,
  detections: LayoutDetection[] = [],
) {
  const facts = createPageFacts(documentId, native, 1);
  const observations: LayoutObservations = {
    schemaVersion: 1,
    kind: "layout-observations",
    documentId,
    page: native.page,
    cacheKey: LAYOUT_OBSERVATIONS_KEY,
    detections,
    observedAt: 1,
  };
  const fragment = assemblePageSemantics(facts, observations);
  const semantics = buildDocumentSemantics(documentId, native.page, [fragment]);
  return { facts, observations, fragment, semantics, view: projectSemanticPage(semantics, facts) };
}
export function fixturePage(
  documentId: string,
  native: NativePage,
  detections: LayoutDetection[] = [],
) {
  return fixtureSources(documentId, native, detections).view;
}
