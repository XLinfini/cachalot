import assert from "node:assert/strict";
import { test } from "node:test";
import type { Box, ContentBlock, SelectedRegion } from "../../src/domain/analysis";
import { fixturePage } from "../support/analysis";
import { inferHeadingLevel } from "../../src/application/document-semantics";
import { selectRegion } from "../../src/application/select-region";
import { finishTranslation } from "../../src/application/formula-references";
import {
  finishTranslatedHeadings,
  markedTranslationSource,
  sourceMarkdown,
} from "../../src/application/heading-translation";

const selection = (blocks: NonNullable<SelectedRegion["blocks"]>): SelectedRegion => ({
  documentId: "paper",
  page: 1,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  imageDataUrl: "",
  blockIds: blocks.map((b) => b.id),
  text: blocks.map((b) => b.text).join("\n\n"),
  blocks,
});
const sample = selection([
  { id: "title", kind: "title", headingLevel: 1, text: "A two-line\npaper title", partial: false },
  { id: "intro", kind: "heading", headingLevel: 2, text: "I Introduction", partial: false },
  { id: "body", kind: "paragraph", text: "Body stays a paragraph.", partial: false },
  { id: "method", kind: "heading", headingLevel: 3, text: "A Method", partial: false },
]);

test("source title, section and subsection preserve levels without changing plain selection text", () => {
  assert.match(sample.text, /two-line\npaper/);
  assert.equal(
    sourceMarkdown(sample),
    "# A two-line paper title\n\n## I Introduction\n\nBody stays a paragraph.\n\n### A Method",
  );
  assert.match(
    markedTranslationSource(sample),
    /\[\[heading:title\]\]\nA two-line paper title\n\[\[\/heading:title\]\]/,
  );
  const response =
    "[[heading:title]]\n### 两行\n论文标题\n[[/heading:title]]\n\n[[heading:intro]]I 引言[[/heading:intro]]\n\n正文仍为段落。\n\n[[heading:method]]A 方法[[/heading:method]]";
  const result = finishTranslatedHeadings(sample, response);
  assert.match(result, /# 两行 论文标题/);
  assert.match(result, /## I 引言/);
  assert.match(result, /### A 方法/);
  assert.match(result, /正文仍为段落。/);
  assert.ok(!result.includes("[[heading:"));
  assert.equal(finishTranslation(sample.text, result, []).markdown, result);
  assert.equal(finishTranslatedHeadings(sample, `\`\`\`markdown\n${response}\n\`\`\``), result);
});

test("missing, duplicated, nested, reordered, empty or invented heading boundaries fail visibly", () => {
  const complete = markedTranslationSource(sample);
  const mutations = [
    complete.replace("[[heading:intro]]", ""),
    complete + "[[heading:title]]duplicate[[/heading:title]]",
    complete
      .replace("[[/heading:title]]", "[[heading:intro]]")
      .replace("[[heading:intro]]\nI Introduction", "[[/heading:title]]\nI Introduction"),
    complete.replaceAll("heading:intro", "heading:other"),
    complete.replace("A Method", " \n## "),
    "[[heading:invented]]New title[[/heading:invented]]" + complete,
  ];
  for (const result of mutations)
    assert.throws(() => finishTranslatedHeadings(sample, result), /headingReferencesChanged/);
});

test("partial selection retains heading formatting, never completes the unselected title", () => {
  const characters = Array.from("ABCDE", (text, index) => ({
    index,
    text,
    fontSize: 20,
    box: [0.1 + index * 0.03, 0.1, 0.12 + index * 0.03, 0.13] as Box,
    generated: false,
  }));
  const page = fixturePage(
    "paper",
    { page: 1, width: 600, height: 1000, characters, objects: [], warnings: [] },
    [{ kind: "title", box: [0.08, 0.08, 0.4, 0.15], confidence: 1 }],
  );
  const clipped = selectRegion(page, [0.095, 0.08, 0.15, 0.15]);
  assert.equal(clipped.text, "AB");
  assert.equal(clipped.blocks[0].partial, true);
  assert.equal(sourceMarkdown({ ...sample, ...clipped }), "# AB");
  assert.ok(!markedTranslationSource({ ...sample, ...clipped }).includes("CDE"));
});

test("cached overlapping predictions recover the title and Roman/letter/numeric section hierarchy", () => {
  const block = (
    id: string,
    text: string,
    kind: ContentBlock["kind"] = "heading",
  ): ContentBlock => ({
    id,
    text,
    kind,
    box: [0.1, 0.1, 0.9, 0.2],
    characterIndices: [],
    objectIds: [],
    confidence: 1,
  });
  const page = {
    blocks: [block("section", "II Methods"), block("title", "", "title")],
  };
  assert.equal(inferHeadingLevel(block("overlap", "Paper title"), page.blocks), 1);
  page.blocks = [block("section", "II Methods")];
  for (const [text, expected] of [
    ["II Methods", 2],
    ["A Method", 3],
    ["C Settings", 3],
    ["D Analysis", 3],
    ["2 Main section", 2],
    ["2.1 Subsection", 3],
    ["2.1.1 Detail", 4],
    ["Unnumbered heading", 2],
  ] as const)
    assert.equal(inferHeadingLevel(block("heading", text), page.blocks), expected, text);
  assert.equal(
    inferHeadingLevel({ ...block("heading", "Whatever"), headingLevel: 5 }, page.blocks),
    5,
  );
  assert.equal(
    inferHeadingLevel(block("body", "A normal sentence", "paragraph"), page.blocks),
    undefined,
  );
});

test("heading formula anchors survive both heading conversion and formula validation", () => {
  const input = selection([
    {
      id: "heading",
      kind: "heading",
      headingLevel: 3,
      partial: false,
      text: "Gain [[formula:eq]]",
    },
  ]);
  const markdown = finishTranslatedHeadings(
    input,
    "[[heading:heading]]增益 [[formula:eq]][[/heading:heading]]",
  );
  assert.match(markdown, /### 增益 \[\[formula:eq\]\]/);
  assert.throws(
    () => finishTranslation(input.text, markdown.replace("[[formula:eq]]", "x"), []),
    /formulaReferencesChanged/,
  );
});
