import type { SelectedRegion, SelectedTextBlock, SelectionUnit } from "./types";
import type { Box, FormulaFragment } from "../../sdk";
import { area, characterText, containsCenter, intersection, union } from "../../sdk";
import type { SemanticPageView } from "../../sdk";
import { formulaMarker } from "./formula-slots";
import { translationContext } from "./context";

/** Rectangle selection accepts whole semantic units, including their inline
 * formulas. Native fallback lines do not establish complete paragraph bounds. */
export function selectRegionUnits(page: SemanticPageView, box: Box): SelectionUnit[] {
  if (page.stage !== "layout") return [];
  const nodes = new Map(page.document.nodes.map((node) => [node.id, node]));
  const characters = new Map(
    page.facts.characters.map((character) => [character.index, character]),
  );
  const byId = new Map(page.blocks.map((block) => [block.id, block]));
  return page.readingOrder.flatMap((id) => {
    const block = byId.get(id);
    if (
      !block ||
      block.confidence <= 0 ||
      ["figure", "table", "header", "footer"].includes(block.kind) ||
      nodes.get(id)?.sources.some((source) => source.page !== page.page)
    )
      return [];
    const formulas = page.formulas.filter((formula) => formula.blockId === id);
    if (!block.text.trim() && !formulas.length) return [];
    const bounds = union([
      block.box,
      ...block.characterIndices.flatMap((index) => {
        const character = characters.get(index);
        return character && area(character.box) > 0 ? [character.box] : [];
      }),
      ...formulas.map((formula) => formula.box),
    ]);
    // Only absorb numerical roundoff from normalized CSS/PDF conversions.
    const epsilon = 1e-7;
    return bounds[0] >= box[0] - epsilon &&
      bounds[1] >= box[1] - epsilon &&
      bounds[2] <= box[2] + epsilon &&
      bounds[3] <= box[3] + epsilon
      ? [{ id, kind: block.kind, box: bounds }]
      : [];
  });
}

export function selectRegion(page: SemanticPageView, box: Box) {
  const units = selectRegionUnits(page, box);
  const ids = new Set(units.map((unit) => unit.id));
  const blocks = page.blocks.filter((block) => ids.has(block.id));
  const formulas = page.formulas.filter((formula) => ids.has(formula.blockId));
  const glyphs = new Set([
    ...blocks.flatMap((block) => block.characterIndices),
    ...formulas.flatMap((formula) => formula.characterIndices),
  ]);
  const result = selectTextRegion({ ...page, blocks, formulas }, box, glyphs);
  return {
    ...result,
    units,
    blocks: result.blocks.map((block) => ({ ...block, partial: false })),
    formulas: result.formulas.map((formula) => ({ ...formula, partial: false })),
  };
}

/** Text mode uses exact DOM glyph coverage without completing words or formulas. */
export function selectTextRegion(
  page: SemanticPageView,
  box: Box,
  selectedGlyphs?: Set<number>,
): Pick<SelectedRegion, "source" | "context"> & {
  text: string;
  blockIds: string[];
  formulas: FormulaFragment[];
  blocks: SelectedTextBlock[];
} {
  const selected =
    selectedGlyphs ||
    new Set(
      page.facts.characters
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
        characters: page.facts.characters.filter((c) => indices.has(c.index)),
        nativeText: characterText(page.facts.characters, indices),
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
              text: own.map((f) => formulaMarker(f.id)).join("\n\n"),
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
      const prefix = characterText(page.facts.characters, before);
      const previous = page.facts.characters.find((c) => c.index === first - 1)?.text || "";
      text += prefix + (prefix && /\s/u.test(previous) ? " " : "") + formulaMarker(formula.id);
      const last = formula.characterIndices.at(-1)!;
      const next = page.facts.characters.find((c) => c.index === last + 1)?.text || "";
      if (/\s/u.test(next)) text += " ";
      remaining = new Set([...remaining].filter((index) => index > last));
    }
    text += characterText(page.facts.characters, remaining);
    return text
      ? [
          {
            id,
            kind: block.kind,
            text,
            headingLevel: block.headingLevel,
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
    source: {
      factsKey: page.facts.cacheKey,
      semanticsKey: page.document.cacheKey,
      semanticRevision: page.document.revision,
      characterIndices: [...selected].sort((a, b) => a - b),
    },
    context: translationContext(
      page.document,
      chunks.length ? chunks.map((block) => block.id) : blocks.map((block) => block.id),
    ),
  };
}
