import assert from "node:assert/strict";
import { test } from "node:test";
import type { Box, ContentBlock, NativePage } from "../../src/domain/analysis";
import { readingOrder } from "../../src/application/document-analysis/page-semantics";
import { fixturePage } from "../support/analysis";
import { selectTextRegion } from "../../src/application/selection-translation/select-region";
import {
  selectRegion as selectWholeRegion,
  selectRegionUnits,
} from "../../src/application/selection-translation/select-region";
import { semanticFixture } from "../fixtures/document-semantics";

const block = (id: string, box: Box): ContentBlock => ({
  id,
  box,
  kind: "paragraph",
  confidence: 1,
  text: "",
  characterIndices: [],
  objectIds: [],
});

test("double columns are read within each band separated by full-width content", () => {
  const blocks = [
    block("right-top", [0.55, 0.2, 0.9, 0.4]),
    block("title", [0.1, 0.05, 0.9, 0.1]),
    block("left-top", [0.1, 0.2, 0.45, 0.4]),
    block("span", [0.1, 0.45, 0.9, 0.55]),
    block("right-bottom", [0.55, 0.6, 0.9, 0.8]),
    block("left-bottom", [0.1, 0.6, 0.45, 0.8]),
  ];
  assert.deepEqual(readingOrder(blocks), [
    "title",
    "left-top",
    "right-top",
    "span",
    "left-bottom",
    "right-bottom",
  ]);
});

test("text mode never expands half-word glyph coverage; figure labels stay with the figure", () => {
  const native: NativePage = {
    page: 1,
    width: 612,
    height: 792,
    objects: [],
    warnings: [],
    characters: Array.from("ABCDE XYZ", (text, index) => ({
      index,
      text,
      fontSize: 10,
      generated: false,
      box: [0.1 + index * 0.025, 0.2, 0.12 + index * 0.025, 0.22] as Box,
    })),
  };
  const page = fixturePage("test", native, [
    { kind: "paragraph", box: [0.08, 0.18, 0.5, 0.25], confidence: 1 },
    { kind: "figure", box: [0.24, 0.18, 0.5, 0.25], confidence: 1 },
  ]);
  assert.equal(selectTextRegion(page, [0.08, 0.18, 0.17, 0.25]).text, "ABC");
  assert.equal(selectTextRegion(page, [0, 0, 1, 1]).text, "ABCDE");
  assert.equal(page.blocks.find((b) => b.kind === "figure")?.text, "XYZ");
});

test("native text missed by the model remains available as a fallback block", () => {
  const native: NativePage = {
    page: 1,
    width: 612,
    height: 792,
    objects: [],
    warnings: [],
    characters: [
      { index: 0, text: "A", fontSize: 10, generated: false, box: [0.1, 0.2, 0.12, 0.22] },
    ],
  };
  const page = fixturePage("test", native, [
    { kind: "title", box: [0.1, 0.05, 0.9, 0.1], confidence: 0.99 },
  ]);
  assert.equal(page.plainText, "A");
  assert.equal(page.blocks.find((b) => b.text === "A")?.confidence, 0);
  assert.ok(page.warnings.length);
});

test("source facts remain separate from inferred nested panels", () => {
  const page = fixturePage(
    "test",
    { page: 1, width: 612, height: 792, characters: [], objects: [], warnings: [] },
    [
      { kind: "figure", box: [0.1, 0.1, 0.9, 0.6], confidence: 0.99 },
      { kind: "figure", box: [0.15, 0.15, 0.45, 0.55], confidence: 0.98 },
    ],
  );
  assert.equal("blocks" in page.facts, false);
  assert.equal(page.blocks[1].parentId, page.blocks[0].id);
  assert.equal(page.document.relations[0].kind, "panel-of");
});

test("rectangle selection accepts complete units only and keeps reading order and context", () => {
  const { view } = semanticFixture(1, [
    { kind: "heading", text: "1 Method", box: [0.1, 0.1, 0.45, 0.14] },
    { kind: "paragraph", text: "Complete paragraph.", box: [0.1, 0.2, 0.45, 0.3] },
    { kind: "formula", text: "x=1", box: [0.1, 0.35, 0.4, 0.4] },
    { kind: "paragraph", text: "Partly enclosed.", box: [0.1, 0.45, 0.45, 0.55] },
    { kind: "figure", text: "Figure labels", box: [0.55, 0.2, 0.8, 0.4] },
  ]);
  assert.equal(selectWholeRegion(view, [0.1, 0.2, 0.3, 0.3]).text, "");
  assert.deepEqual(selectRegionUnits(view, [0.1, 0.2, 0.3, 0.3]), []);
  const selected = selectWholeRegion(view, [0.09, 0.19, 0.81, 0.5]);
  assert.deepEqual(
    selected.units.map((unit) => unit.id),
    ["p1-b1", "p1-b2"],
  );
  assert.deepEqual(
    selected.blockIds,
    selected.units.map((unit) => unit.id),
  );
  assert.match(selected.text, /^Complete paragraph\.\n\n\[\[formula:/);
  assert.equal(selected.text.includes("Partly"), false);
  assert.equal(selected.text.includes("Figure"), false);
  assert.ok(selected.blocks.every((block) => !block.partial));
  assert.ok(selected.formulas.every((formula) => !formula.partial));
  assert.deepEqual(selected.context?.sectionPath, ["1 Method"]);
  assert.deepEqual(selected.source?.characterIndices, [
    ...view.blocks[1].characterIndices,
    ...view.blocks[2].characterIndices,
  ]);
  assert.equal(selectWholeRegion(view, view.blocks[1].box).text, "Complete paragraph.");
  assert.equal(selectWholeRegion(view, [0.1, 0.35, 0.399, 0.4]).formulas.length, 0);
});

test("inline formulas belong to the complete paragraph and their bounds must also fit", () => {
  const { view } = semanticFixture(1, [
    { kind: "paragraph", text: "The angle is θ.", box: [0.1, 0.2, 0.5, 0.3] },
  ]);
  assert.equal(view.formulas.length, 1);
  assert.equal(view.formulas[0].mode, "inline");
  assert.deepEqual(selectWholeRegion(view, view.formulas[0].box).units, []);
  const selected = selectWholeRegion(view, [0.1, 0.2, 0.5, 0.3]);
  assert.equal(selected.units.length, 1);
  assert.equal(selected.formulas.length, 1);
  assert.equal(selected.formulas[0].latex, view.formulas[0].latex);
  assert.equal(selected.formulas[0].nativeText, "θ");
  assert.equal(selected.formulas[0].partial, false);
  const extended = {
    ...view,
    formulas: [{ ...view.formulas[0], box: [0.1, 0.2, 0.51, 0.3] as Box }],
  };
  assert.equal(selectWholeRegion(extended, [0.1, 0.2, 0.5, 0.3]).units.length, 0);
  assert.equal(selectWholeRegion(extended, [0.1, 0.2, 0.51, 0.3]).units.length, 1);
});

test("unknown native lines and multi-page fragments cannot masquerade as complete paragraphs", () => {
  const { view } = semanticFixture(1, [
    { kind: "paragraph", text: "A paragraph.", box: [0.1, 0.2, 0.45, 0.3] },
  ]);
  assert.deepEqual(selectRegionUnits({ ...view, stage: "native" }, [0, 0, 1, 1]), []);
  assert.deepEqual(
    selectRegionUnits(
      { ...view, blocks: view.blocks.map((block) => ({ ...block, confidence: 0 })) },
      [0, 0, 1, 1],
    ),
    [],
  );
  const node = view.document.nodes[0];
  const multiPage = {
    ...view,
    document: {
      ...view.document,
      nodes: [{ ...node, sources: [...node.sources, { ...node.sources[0], page: 2 }] }],
    },
  };
  assert.deepEqual(selectRegionUnits(multiPage, [0, 0, 1, 1]), []);
});
