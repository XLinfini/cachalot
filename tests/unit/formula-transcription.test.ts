import assert from "node:assert/strict";
import { test } from "node:test";
import type { FormulaFragment, PdfCharacter } from "../../src/domain/analysis";
import {
  formulaEvidence,
  preservesNativeCharacters,
  validLatex,
} from "../../src/application/formula-transcription";

const glyph = (index: number, text: string, x: number, y = 0.2): PdfCharacter => ({
  index,
  text,
  box: [x, y - 0.01, x + 0.008, y + 0.002],
  origin: [x, y],
  fontSize: 1,
  emSize: 10,
  generated: false,
  fontName: "MathFont",
});
const formula: FormulaFragment = {
  id: "equation",
  documentId: "paper",
  page: 2,
  box: [0.05, 0.1, 0.98, 0.3],
  mode: "display",
  pageWidth: 600,
  pageHeight: 1000,
  blockId: "block",
  characterIndices: [0, 1, 2, 3, 4, 5, 6, 7],
  nativeText: "o θ C = 0 (1)",
  latex: null,
  recognition: "unrecognized",
  characters: [
    glyph(0, "o", 0.2, 0.18),
    glyph(1, "θ", 0.21, 0.184),
    glyph(2, "C", 0.1),
    glyph(3, "=", 0.12),
    glyph(4, "0", 0.2, 0.22),
    glyph(5, "(", 0.9),
    glyph(6, "1", 0.91),
    glyph(7, ")", 0.92),
  ],
};

test("evidence preserves extraction order and Unicode with crop-local geometry, not the nominal font size", () => {
  const input = formulaEvidence(formula);
  assert.deepEqual(
    input.glyphs.map((c) => c.text),
    ["o", "θ", "C", "=", "0", "(", "1", ")"],
  );
  assert.deepEqual(input.glyphs[0].origin, [90, 80]);
  assert.deepEqual(input.glyphs[0].box, [90, 70, 94.8, 82]);
  assert.equal(input.glyphs[0].emSize, 10);
  assert.deepEqual(
    input.glyphs.filter((c) => c.role === "equation-label").map((c) => c.index),
    [5, 6, 7],
  );
});

test("native checks distinguish 0/o, preserve Greek characters and do not count LaTeX command names", () => {
  const correct = "C=\\frac{o_\\theta}{0}";
  assert.ok(validLatex(correct));
  assert.ok(preservesNativeCharacters(formula, correct));
  assert.ok(!preservesNativeCharacters(formula, "C=\\frac{0_\\theta}{0}"));
  assert.ok(!preservesNativeCharacters(formula, "C=\\frac{o_\\beta}{0}"));
  assert.ok(!preservesNativeCharacters(formula, "\\frac{o_\\theta}{0}"));
  // A rendered function name counts once, not its source command spelling.
  const arctan = {
    ...formula,
    mode: "inline" as const,
    characters: Array.from("arctan").map((s, i) => glyph(i, s, 0.1 + 0.01 * i)),
  };
  assert.ok(preservesNativeCharacters(arctan, "\\arctan"));
});

test("an adjacent parenthesized operand and inline numbers are never stripped as equation labels", () => {
  const adjacent = {
    ...formula,
    characters: formula.characters!.map((c) =>
      c.index >= 5
        ? {
            ...c,
            box: [c.box[0] - 0.67, c.box[1], c.box[2] - 0.67, c.box[3]] as PdfCharacter["box"],
          }
        : c,
    ),
  };
  assert.ok(formulaEvidence(adjacent).glyphs.every((c) => c.role === "body"));
  assert.ok(!preservesNativeCharacters(adjacent, "C=\\frac{o_\\theta}{0}"));
  assert.ok(formulaEvidence({ ...formula, mode: "inline" }).glyphs.every((c) => c.role === "body"));
});

test("missing native glyphs and generated spacing do not make a source authoritative for completeness or structure", () => {
  assert.ok(preservesNativeCharacters({ ...formula, characters: [] }, "\\frac{x}{y}"));
  const generated = { ...formula, characters: [{ ...glyph(99, "z", 0.15), generated: true }] };
  assert.ok(preservesNativeCharacters(generated, "x"));
  // Same glyph counts can still describe a WRONG fraction: review is required.
  assert.ok(preservesNativeCharacters(formula, "C=\\frac{0}{o_\\theta}"));
  assert.ok(preservesNativeCharacters(formula, "C=\\frac{o_\\theta}{0}+z"));
  assert.ok(!validLatex("\\includegraphics{https://example.invalid/image}"));
  assert.ok(!validLatex("\\frac{x}{"));
});
