import type { BlockKind, Box, NativePage } from "../../src/domain/analysis";
import { fixtureSources } from "../support/analysis";

/** Small synthetic native pages with independently supplied model detections. */
export function semanticFixture(
  page: number,
  entries: { kind: BlockKind; text: string; box: Box }[],
  documentId = "semantic-paper",
) {
  const native: NativePage = {
    page,
    width: 600,
    height: 1000,
    objects: [],
    warnings: [],
    characters: [],
  };
  for (const entry of entries) {
    const letters = [...entry.text],
      step = (entry.box[2] - entry.box[0]) / Math.max(letters.length, 1);
    for (const [offset, text] of letters.entries())
      native.characters.push({
        index: native.characters.length,
        text,
        box: [
          entry.box[0] + offset * step,
          entry.box[1] + 0.005,
          entry.box[0] + (offset + 0.8) * step,
          entry.box[1] + 0.015,
        ],
        fontSize: 10,
        emSize: 10,
        fontName: "Fixture",
        generated: false,
      });
  }
  return fixtureSources(
    documentId,
    native,
    entries.map((entry) => ({ kind: entry.kind, box: entry.box, confidence: 0.9 })),
  );
}
