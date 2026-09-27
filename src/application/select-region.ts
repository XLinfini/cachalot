import type { Box, FormulaFragment, PageAnalysis, SelectedTextBlock } from "../domain/analysis";
import { area, characterText, containsCenter, intersection } from "../domain/geometry";
import { selectedHeadingLevel } from "./heading-translation";

/** A glyph is selected when its centre lies in the rectangle. No text-run expansion. */
export function selectRegion(
  page: PageAnalysis,
  box: Box,
  selectedGlyphs?: Set<number>,
): { text: string; blockIds: string[]; formulas: FormulaFragment[]; blocks: SelectedTextBlock[] } {
  const selected =
    selectedGlyphs ||
    new Set(
      page.characters
        .filter((c) => area(c.box) > 0 && containsCenter(box, c.box))
        .map((c) => c.index),
    );
  const blocks = page.blocks.filter((block) => intersection(block.box, box) > 0);
  // Figures/formulas/tables remain intact in the source preview. Their native
  // labels must not accidentally become ordinary body text during reflow.
  const retained = new Set(
    blocks
      .filter((b) => ["figure", "formula", "table"].includes(b.kind))
      .flatMap((b) => b.characterIndices),
  );
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const formulas = (page.formulas || [])
    .filter(
      (f) =>
        intersection(f.box, box) > 0 &&
        (f.mode === "display" || f.characterIndices.some((index) => selected.has(index))),
    )
    .map((f) => {
      const partial =
        f.characterIndices.some((index) => !selected.has(index)) ||
        intersection(f.box, box) / area(f.box) < 0.98;
      const characterIndices = f.characterIndices.filter((i) => !partial || selected.has(i));
      const indices = new Set(characterIndices);
      const evidence = {
        ...f,
        characterIndices,
        characters: page.characters.filter((c) => indices.has(c.index)),
        nativeText: characterText(page.characters, indices),
      };
      return partial
        ? {
            ...evidence,
            id: `${f.id}-clip-${box.map((n) => Math.round(n * 1000000)).join("-")}`,
            partial: true,
            latex: null,
            recognition: "unrecognized" as const,
            box: [
              Math.max(f.box[0], box[0]),
              Math.max(f.box[1], box[1]),
              Math.min(f.box[2], box[2]),
              Math.min(f.box[3], box[3]),
            ] as Box,
          }
        : evidence;
    });
  const chunks = page.readingOrder.flatMap<SelectedTextBlock>((id) => {
    const block = byId.get(id);
    if (!block || ["figure", "table", "header", "footer"].includes(block.kind)) return [];
    const own = formulas.filter((f) => f.blockId === id);
    if (block.kind === "formula")
      return own.length
        ? [
            {
              id,
              kind: block.kind,
              text: own.map((f) => `[[formula:${f.id}]]`).join("\n\n"),
              partial: own.some((f) => f.partial),
            },
          ]
        : [];
    const indices = new Set(
      block.characterIndices.filter((index) => selected.has(index) && !retained.has(index)),
    );
    const ordered = [...own].sort((a, b) => a.characterIndices[0] - b.characterIndices[0]);
    let text = "",
      remaining = new Set(indices);
    for (const formula of ordered) {
      const first = formula.characterIndices[0];
      const before = new Set([...remaining].filter((index) => index < first));
      const prefix = characterText(page.characters, before);
      const previous = page.characters.find((c) => c.index === first - 1)?.text || "";
      text += prefix + (prefix && /\s/u.test(previous) ? " " : "") + `[[formula:${formula.id}]]`;
      const last = formula.characterIndices.at(-1)!;
      const next = page.characters.find((c) => c.index === last + 1)?.text || "";
      if (/\s/u.test(next)) text += " ";
      remaining = new Set([...remaining].filter((index) => index > last));
    }
    text += characterText(page.characters, remaining);
    return text
      ? [
          {
            id,
            kind: block.kind,
            text,
            headingLevel: selectedHeadingLevel(block, page),
            partial: block.characterIndices.some((index) => !selected.has(index)),
          },
        ]
      : [];
  });
  return {
    text: chunks.map((block) => block.text).join("\n\n"),
    blockIds: blocks.map((b) => b.id),
    formulas,
    blocks: chunks,
  };
}
