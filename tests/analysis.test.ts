import assert from "node:assert/strict";
import { test } from "node:test";
import type { Box, ContentBlock, NativePage } from "../src/domain/analysis";
import { assemblePage, readingOrder } from "../src/application/assemble-page";
import { selectRegion } from "../src/application/select-region";

const block = (id: string, box: Box): ContentBlock => ({ id, box, kind: "paragraph", confidence: 1, text: "", characterIndices: [], objectIds: [] });

test("double columns are read within each band separated by full-width content", () => {
  const blocks = [block("right-top", [.55, .2, .9, .4]), block("title", [.1, .05, .9, .1]),
    block("left-top", [.1, .2, .45, .4]), block("span", [.1, .45, .9, .55]),
    block("right-bottom", [.55, .6, .9, .8]), block("left-bottom", [.1, .6, .45, .8])];
  assert.deepEqual(readingOrder(blocks), ["title", "left-top", "right-top", "span", "left-bottom", "right-bottom"]);
});

test("half-word rectangle never expands to the unselected suffix; figure labels stay with the figure", () => {
  const native: NativePage = { page: 1, width: 612, height: 792, objects: [], warnings: [], characters:
    Array.from("ABCDE XYZ", (text, index) => ({ index, text, fontSize: 10, generated: false,
      box: [.1 + index * .025, .2, .12 + index * .025, .22] as Box })) };
  const page = assemblePage("test", native, [{ kind: "paragraph", box: [.08, .18, .5, .25], confidence: 1 },
    { kind: "figure", box: [.24, .18, .5, .25], confidence: 1 }], "test");
  assert.equal(selectRegion(page, [.08, .18, .17, .25]).text, "ABC");
  assert.equal(selectRegion(page, [0, 0, 1, 1]).text, "ABCDE");
  assert.equal(page.blocks.find(b => b.kind === "figure")?.text, "XYZ");
});

test("native text missed by the model remains available as a fallback block", () => {
  const native: NativePage = { page: 1, width: 612, height: 792, objects: [], warnings: [], characters:
    [{ index: 0, text: "A", fontSize: 10, generated: false, box: [.1, .2, .12, .22] }] };
  const page = assemblePage("test", native, [{ kind: "title", box: [.1, .05, .9, .1], confidence: .99 }], "test");
  assert.equal(page.plainText, "A");
  assert.equal(page.blocks.find(b => b.text === "A")?.confidence, 0);
  assert.ok(page.warnings.length);
});

test("analyzing a cached native DTO must replace its cache key and record nested panels", () => {
  const native = assemblePage("test", { page: 1, width: 612, height: 792, characters: [], objects: [], warnings: [] }, [], "native");
  const page = assemblePage("test", native, [{ kind: "figure", box: [.1, .1, .9, .6], confidence: .99 },
    { kind: "figure", box: [.15, .15, .45, .55], confidence: .98 }], "semantic-v2");
  assert.equal(page.cacheKey, "semantic-v2");
  assert.equal(page.blocks[1].parentId, page.blocks[0].id);
});
