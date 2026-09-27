import assert from "node:assert/strict";
import { test } from "node:test";
import type { Box, FormulaAsset, NativePage, PdfCharacter } from "../src/domain/analysis";
import { assemblePage } from "../src/application/assemble-page";
import { nativeLatex } from "../src/application/formula-analysis";
import { selectRegion } from "../src/application/select-region";
import { finishTranslation, formulaClipboard } from "../src/application/formula-references";

const glyph = (index: number, text: string, x: number, y = 0.2, size = 10): PdfCharacter => ({
  index,
  text,
  fontSize: 1,
  emSize: size,
  italic: true,
  origin: [x, y],
  box: [x, y - size / 1000, x + 0.008, y + 0.002],
  generated: false,
});
const native = (characters: PdfCharacter[]): NativePage => ({
  page: 1,
  width: 600,
  height: 1000,
  objects: [],
  warnings: [],
  characters,
});
const paragraph = { kind: "paragraph" as const, confidence: 1, box: [0, 0.1, 0.9, 0.3] as Box };

test("effective em size and origin recover subscripts; nominal PDF font size alone is insufficient", () => {
  const chars = [
    glyph(0, "I", 0.1),
    glyph(1, "o", 0.108, 0.202, 6),
    glyph(2, "p", 0.116, 0.202, 6),
  ];
  assert.equal(nativeLatex(chars, 1000), "I_{op}");
  const page = assemblePage("paper", native(chars), [paragraph], "formulas-v1");
  assert.equal(page.formulas?.[0].latex, "I_{op}");
  const selected = selectRegion(page, [0, 0, 1, 1]);
  assert.equal(selected.formulas.length, 1);
  assert.match(selected.text, /^\[\[formula:/);
});

test("Greek symbols and literal inverse-function notation survive; multi-baseline fractions are not guessed", () => {
  assert.equal(nativeLatex([glyph(0, "θ", 0.1)], 1000), "\\theta");
  const inverse = Array.from("arctan−1").map((text, i) =>
    glyph(i, text, 0.1 + i * 0.008, i >= 6 ? 0.195 : 0.2, i >= 6 ? 6 : 10),
  );
  assert.match(nativeLatex(inverse, 1000)!, /^\\arctan \^\{- 1\}$/);
  assert.equal(nativeLatex([glyph(0, "1", 0.1, 0.19), glyph(1, "2", 0.1, 0.21)], 1000), null);
});

test("italic prose does not become a formula; partial formula selection never completes an unselected suffix", () => {
  const prose = Array.from("where").map((text, i) => glyph(i, text, 0.1 + i * 0.008));
  assert.equal(assemblePage("paper", native(prose), [paragraph], "v1").formulas?.length, 0);
  const page = assemblePage(
    "paper",
    native([glyph(0, "I", 0.1), glyph(1, "o", 0.108, 0.202, 6), glyph(2, "p", 0.116, 0.202, 6)]),
    [paragraph],
    "v1",
  );
  const selected = selectRegion(page, [0.099, 0.185, 0.109, 0.211]);
  assert.equal(selected.formulas[0].partial, true);
  assert.equal(selected.formulas[0].latex, null);
  assert.deepEqual(selected.formulas[0].characterIndices, [0]);
  assert.deepEqual(
    selected.formulas[0].characters?.map((c) => c.index),
    [0],
  );
  assert.equal(
    selected.formulas[0].nativeText,
    "I",
    "clipped evidence cannot contain an unselected suffix",
  );
  assert.ok(selected.formulas[0].box[2] <= 0.109);
});

test("standalone equations stay in source order and retain source geometry even without readable Unicode", () => {
  const page = assemblePage(
    "paper",
    native([{ ...glyph(0, "A", 0.1, 0.15), italic: false }]),
    [
      { ...paragraph, box: [0, 0.1, 0.9, 0.18] },
      { kind: "formula", confidence: 0.95, box: [0.1, 0.2, 0.8, 0.25] },
    ],
    "v1",
  );
  const selected = selectRegion(page, [0, 0, 1, 1]);
  assert.match(selected.text, /^A\n\n\[\[formula:/);
  assert.equal(selected.formulas[0].mode, "display");
  assert.equal(selected.formulas[0].latex, null);
});

test("translation rejects missing, duplicated, invented and reordered formula references", () => {
  const page = assemblePage(
    "paper",
    native([glyph(0, "θ", 0.1), glyph(2, "A", 0.2), glyph(4, "π", 0.3)]),
    [paragraph],
    "v1",
  );
  // Separate the two formula assets explicitly to exercise reference validation.
  const a = {
    formula: page.formulas![0],
    imageDataUrl: "",
    width: 10,
    height: 10,
    scale: 4,
  } satisfies FormulaAsset;
  const b = { ...a, formula: { ...a.formula, id: "second", latex: "\\pi" } };
  const first = `[[formula:${a.formula.id}]]`,
    second = "[[formula:second]]",
    source = `${first} text ${second}`;
  assert.equal(finishTranslation(source, `${first} 中文 ${second}`, [a, b]).formulas.length, 2);
  for (const result of [
    first,
    `${first}${first}${second}`,
    `${second}${first}`,
    `${first}${second}[[formula:invented]]`,
  ])
    assert.throws(() => finishTranslation(source, result, [a, b]), /formulaReferencesChanged/);
  assert.match(formulaClipboard(first, [a]), /\$/);
});
