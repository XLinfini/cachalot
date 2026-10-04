import type { FormulaFragment, PdfCharacter } from "../../src/domain/analysis";

export const formulaGlyph = (index: number, text: string, x: number, y = 0.2): PdfCharacter => ({
  index,
  text,
  box: [x, y - 0.01, x + 0.008, y + 0.002],
  origin: [x, y],
  fontSize: 1,
  emSize: 10,
  generated: false,
  fontName: "MathFont",
});
export const evidenceFormula: FormulaFragment = {
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
    formulaGlyph(0, "o", 0.2, 0.18),
    formulaGlyph(1, "θ", 0.21, 0.184),
    formulaGlyph(2, "C", 0.1),
    formulaGlyph(3, "=", 0.12),
    formulaGlyph(4, "0", 0.2, 0.22),
    formulaGlyph(5, "(", 0.9),
    formulaGlyph(6, "1", 0.91),
    formulaGlyph(7, ")", 0.92),
  ],
};
