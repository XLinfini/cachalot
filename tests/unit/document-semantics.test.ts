import assert from "node:assert/strict";
import { test } from "node:test";
import { semanticFixture } from "../fixtures/document-semantics";
import {
  buildDocumentSemantics,
  projectSemanticPage,
} from "../../src/application/document-semantics";
import { selectRegion } from "../../src/application/select-region";
import { translationContext } from "../../src/application/translation-context";
import { validDocumentSemantics } from "../../src/infrastructure/analysis/validation";
import { nativeText } from "../../src/domain/page-facts";

test("page facts and model observations never acquire assembled structure or reconstructed formulas", () => {
  const fixture = semanticFixture(1, [
    { kind: "paragraph", text: "θ", box: [0.1, 0.2, 0.2, 0.23] },
    { kind: "formula", text: "x=1", box: [0.1, 0.3, 0.3, 0.33] },
  ]);
  const before = JSON.stringify([fixture.facts, fixture.observations]);
  assert.equal(nativeText(fixture.facts), "θx=1");
  assert.equal("blocks" in fixture.facts, false);
  assert.equal("readingOrder" in fixture.observations, false);
  assert.ok(fixture.semantics.formulas.length);
  assert.ok(
    fixture.semantics.formulas.every(
      (formula) => !("latex" in formula) && !("recognition" in formula),
    ),
  );
  assert.ok(
    fixture.semantics.nodes.some((node) => node.content.some((span) => span.kind === "formula")),
  );
  assert.equal(JSON.stringify([fixture.facts, fixture.observations]), before);
  assert.ok(validDocumentSemantics(fixture.semantics, "semantic-paper", 1));
});

test("document headings use other pages' evidence and page projections update without mutating earlier snapshots", () => {
  const first = semanticFixture(1, [
    { kind: "heading", text: "II Methods", box: [0.1, 0.1, 0.9, 0.14] },
  ]);
  const second = semanticFixture(2, [
    { kind: "heading", text: "A Method", box: [0.1, 0.1, 0.8, 0.14] },
  ]);
  const partial = buildDocumentSemantics("semantic-paper", 2, [second.fragment], 1);
  assert.equal(partial.nodes[0].headingLevel, 2);
  const full = buildDocumentSemantics("semantic-paper", 2, [second.fragment, first.fragment], 2);
  const view = projectSemanticPage(full, second.facts);
  assert.equal(view.blocks[0].headingLevel, 3);
  assert.equal(partial.nodes[0].headingLevel, 2);
  assert.deepEqual(full.readingOrder, ["p1-b0", "p2-b0"]);
  assert.equal(full.sections[1].parentId, full.sections[0].id);
  const selected = selectRegion(view, [0.25, 0.09, 0.7, 0.15]);
  assert.equal(selected.blocks[0].headingLevel, 3);
  assert.equal(selected.blocks[0].partial, true);
  assert.equal(selected.source?.semanticRevision, 2);
});

test("missing pages break sections and paragraph continuity; adjacent unfinished paragraphs remain candidates", () => {
  const first = semanticFixture(1, [
    { kind: "heading", text: "1 Introduction", box: [0.1, 0.1, 0.9, 0.14] },
    { kind: "paragraph", text: "An unfinished sentence", box: [0.1, 0.8, 0.45, 0.85] },
  ]);
  const third = semanticFixture(3, [
    { kind: "paragraph", text: "continues here.", box: [0.1, 0.1, 0.45, 0.14] },
  ]);
  const missing = buildDocumentSemantics("semantic-paper", 3, [first.fragment, third.fragment]);
  assert.deepEqual(missing.coverage.missingPages, [2]);
  assert.equal(
    missing.relations.some((relation) => relation.kind === "continues"),
    false,
  );
  assert.equal(missing.nodes.find((node) => node.id === "p3-b0")?.sectionId, undefined);
  assert.deepEqual(
    translationContext(missing, ["p1-b1"]).passages.map((passage) => passage.nodeId),
    ["p1-b1"],
  );
  const second = semanticFixture(2, [
    { kind: "paragraph", text: "continues here.", box: [0.1, 0.1, 0.45, 0.14] },
  ]);
  const adjacent = buildDocumentSemantics("semantic-paper", 2, [first.fragment, second.fragment]);
  assert.equal(
    adjacent.relations.find((relation) => relation.kind === "continues")?.status,
    "candidate",
  );
  assert.equal(
    adjacent.nodes.length,
    3,
    "candidate continuation must not silently merge source paragraphs",
  );
});

test("a multi-page paragraph projects local glyphs while translation context keeps the complete source node", () => {
  const first = semanticFixture(1, [
    { kind: "paragraph", text: "ABCDE", box: [0.1, 0.8, 0.6, 0.85] },
  ]);
  const second = semanticFixture(2, [
    { kind: "paragraph", text: "FGHIJ", box: [0.1, 0.1, 0.6, 0.15] },
  ]);
  const document = buildDocumentSemantics("semantic-paper", 2, [first.fragment, second.fragment]);
  const merged = {
    ...document.nodes[0],
    text: "ABCDE FGHIJ",
    sources: [...document.nodes[0].sources, ...document.nodes[1].sources],
    content: [
      ...document.nodes[0].content,
      ...document.nodes[1].content.map((span) =>
        span.kind === "text" ? { ...span, sourceIndex: 1 } : span,
      ),
    ],
  };
  const snapshot = { ...document, nodes: [merged], readingOrder: [merged.id], relations: [] };
  const view = projectSemanticPage(snapshot, second.facts);
  assert.equal(view.blocks[0].text, "FGHIJ");
  const selected = selectRegion(view, [0.1, 0.1, 0.3, 0.15]);
  assert.equal(selected.text, "FG");
  assert.deepEqual(selected.source?.characterIndices, [0, 1]);
  assert.equal(selected.context?.passages[0].text, "ABCDE FGHIJ");
  assert.deepEqual(selected.context?.passages[0].pages, [1, 2]);
});

test("abstract and section context preserve exact half-word scope and bounded background excerpts", () => {
  const fixture = semanticFixture(1, [
    { kind: "title", text: "A paper title", box: [0.1, 0.05, 0.9, 0.08] },
    { kind: "heading", text: "Abstract", box: [0.1, 0.1, 0.9, 0.13] },
    { kind: "paragraph", text: "Study background.", box: [0.1, 0.15, 0.9, 0.19] },
    { kind: "heading", text: "1 Method", box: [0.1, 0.25, 0.9, 0.29] },
    { kind: "paragraph", text: "ABCDE", box: [0.1, 0.35, 0.6, 0.39] },
    { kind: "paragraph", text: "A following paragraph.", box: [0.1, 0.45, 0.9, 0.49] },
  ]);
  const selection = selectRegion(fixture.view, [0.1, 0.35, 0.3, 0.4]);
  assert.equal(selection.text, "AB");
  assert.equal(selection.context?.title, "A paper title");
  assert.equal(selection.context?.abstract, "Study background.");
  assert.deepEqual(selection.context?.sectionPath, ["1 Method"]);
  assert.deepEqual(
    selection.context?.passages.map((passage) => passage.text),
    ["ABCDE", "A following paragraph."],
  );
  assert.equal(selection.blocks[0].partial, true);
  assert.equal(selection.context?.semanticRevision, selection.source?.semanticRevision);
  const invalid = structuredClone(fixture.semantics);
  invalid.sections[0].parentId = invalid.sections[0].id;
  assert.equal(
    validDocumentSemantics(invalid, "semantic-paper", 1),
    false,
    "cyclic section caches must be rejected",
  );
  const wrongCoverage = {
    ...fixture.semantics,
    coverage: { ...fixture.semantics.coverage, layoutPages: [] },
  };
  assert.equal(validDocumentSemantics(wrongCoverage, "semantic-paper", 1), false);
});
