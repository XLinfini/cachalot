import type { PdfAlignment, ReaderAnchor } from "./document-workbench";
import type { Box } from "./analysis";

export function validBox(box: Box): boolean {
  return (
    Array.isArray(box) &&
    box.length === 4 &&
    box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) &&
    box[0] < box[2] &&
    box[1] < box[3]
  );
}
export function validateAlignment(
  alignment: PdfAlignment[],
  originalPages: number,
  derivedPages: number,
): void {
  if (!Array.isArray(alignment) || alignment.length > 100000)
    throw new Error("Invalid PDF alignment");
  const ids = new Set<string>();
  const region = (item: { page: number; box: Box }, total: number) => {
    if (
      !item ||
      !Number.isInteger(item.page) ||
      item.page < 1 ||
      item.page > total ||
      !validBox(item.box)
    )
      throw new Error("Invalid PDF alignment region");
  };
  for (const item of alignment) {
    if (
      !item ||
      typeof item.id !== "string" ||
      !item.id ||
      item.id.length > 256 ||
      ids.has(item.id)
    )
      throw new Error("Invalid PDF alignment ID");
    ids.add(item.id);
    region(item.original, originalPages);
    if (!Array.isArray(item.derived) || !item.derived.length || item.derived.length > 1000)
      throw new Error("Invalid derived PDF alignment");
    for (const target of item.derived) region(target, derivedPages);
  }
}
/** Map a reading line through semantic regions, including continuation pages. */
export function mapComparisonAnchor(
  alignment: PdfAlignment[],
  side: "original" | "derived",
  anchor: ReaderAnchor,
): ReaderAnchor {
  const spans = alignment
    .flatMap((item) => {
      const total = item.derived.reduce((sum, region) => sum + region.box[3] - region.box[1], 0);
      let offset = 0;
      return item.derived.map((target) => {
        const length = (target.box[3] - target.box[1]) / total;
        const height = item.original.box[3] - item.original.box[1];
        const original = {
          page: item.original.page,
          start: item.original.box[1] + height * offset,
          end: item.original.box[1] + height * (offset + length),
        };
        offset += length;
        const derived = { page: target.page, start: target.box[1], end: target.box[3] };
        return side === "original"
          ? { from: original, to: derived }
          : { from: derived, to: original };
      });
    })
    .filter((span) => span.from.page === anchor.page);
  if (!spans.length) return { ...anchor };
  const distance = (span: (typeof spans)[number]) =>
    Math.max(span.from.start - anchor.fraction, anchor.fraction - span.from.end, 0);
  const span = spans.reduce((best, item) => (distance(item) < distance(best) ? item : best));
  const fraction = Math.max(
    0,
    Math.min(1, (anchor.fraction - span.from.start) / (span.from.end - span.from.start)),
  );
  return { page: span.to.page, fraction: span.to.start + fraction * (span.to.end - span.to.start) };
}
