import assert from "node:assert/strict";
import { test } from "node:test";
import type { Box, ContentBlock, NativePage } from "../../src/domain/analysis";
import { readingOrder } from "../../src/application/assemble-page-semantics";
import { fixturePage } from "../support/analysis";
import { selectRegion } from "../../src/application/select-region";

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

test("half-word rectangle never expands to the unselected suffix; figure labels stay with the figure", () => {
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
  assert.equal(selectRegion(page, [0.08, 0.18, 0.17, 0.25]).text, "ABC");
  assert.equal(selectRegion(page, [0, 0, 1, 1]).text, "ABCDE");
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
