import { buildDocumentSemantics } from "../../src/application/document-analysis/document-semantics";
import type { ContentBlock, NativePage } from "../../src/domain/analysis";
import type { FormulaRecord } from "../../src/infrastructure/formula-repository";

// A small synthetic PDF supports storage and reader navigation without a real paper.
export function cacheFixturePdf(
  pageCount = 1,
  options: {
    content?: string;
    cropBox?: string;
    rotation?: number;
    resources?: string;
    extraObjects?: string[];
  } = {},
): Uint8Array {
  const content = options.content ?? "BT /F1 14 Tf 30 350 Td (Cache fixture paper) Tj ET\n";
  const pageExtras = `${options.cropBox ? `/CropBox [${options.cropBox}]` : ""} ${options.rotation ? `/Rotate ${options.rotation}` : ""}`;
  const kids = Array.from(
    { length: pageCount },
    (_, index) => (index === 0 ? 3 : 4 + index * 2) + " 0 R",
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [" + kids.join(" ") + "] /Count " + pageCount + " >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] " +
      pageExtras +
      " /Resources << /Font << /F1 5 0 R >> " +
      (options.resources ?? "") +
      " >> /Contents 4 0 R >>",
    "<< /Length " + content.length + " >>\nstream\n" + content + "endstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (let index = 1; index < pageCount; index++) {
    objects.push(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents " +
        (5 + index * 2) +
        " 0 R >>",
      "<< /Length " + content.length + " >>\nstream\n" + content + "endstream",
    );
  }
  objects.push(...(options.extraObjects ?? []));
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += index + 1 + " 0 obj\n" + object + "\nendobj\n";
  });
  const xref = pdf.length,
    size = objects.length + 1;
  pdf +=
    "xref\n0 " +
    size +
    "\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size " +
    size +
    " /Root 1 0 R >>\nstartxref\n" +
    xref +
    "\n%%EOF";
  return new TextEncoder().encode(pdf);
}

/** Nested Forms, clipping, dashed vector strokes and a filtered image. No user PDF. */
export function nativeGraphicsFixturePdf(rotation = 0, repeatedForm = false): Uint8Array {
  const stream = (dictionary: string, content: string) =>
    `<< ${dictionary} /Length ${content.length} >>\nstream\n${content}endstream`;
  return cacheFixturePdf(1, {
    rotation,
    cropBox: "10 20 290 390",
    resources: "/XObject << /Im 6 0 R /Outer 7 0 R >>",
    content:
      "0 0 1 rg 210 220 30 30 re f\nq 1 0 0 1 50 70 cm /Outer Do Q\nq 30 0 0 20 170 110 cm /Im Do Q\n" +
      (repeatedForm ? "q 1 0 0 1 100 200 cm /Outer Do Q\n" : ""),
    extraObjects: [
      stream(
        "/Type /XObject /Subtype /Image /Width 2 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode",
        "FF000000FF00>\n",
      ),
      stream(
        "/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Matrix [1.5 0 0 1.5 10 20] /Resources << /Font << /F1 5 0 R >> /XObject << /Inner 8 0 R >> >>",
        "0 0 60 70 re W n\nq 1 0 0 1 5 6 cm /Inner Do Q\nBT /F1 10 Tf 3 65 Td (Sibling) Tj ET\n",
      ),
      stream(
        "/Type /XObject /Subtype /Form /BBox [0 0 80 80] /Matrix [1 0 0 1 3 4] /Resources << /Font << /F1 5 0 R >> >>",
        "BT /F1 12 Tf 4 35 Td (Nested formula) Tj ET\n1 0 0 RG 2 w [3 2] 1 d 0 25 m 50 25 l S\n",
      ),
    ],
  });
}

// Historical payloads intentionally retain the old mixed shape for migration
// and all-version cache clearing. Production exports no legacy analysis type.
interface LegacyCacheEntry extends NativePage {
  schemaVersion: 1;
  documentId: string;
  cacheKey: string;
  blocks: ContentBlock[];
  readingOrder: string[];
  plainText: string;
  analyzedAt: number;
}
const page = (cacheKey: string, documentId = "cache-paper"): LegacyCacheEntry => ({
  schemaVersion: 1,
  documentId,
  cacheKey,
  page: 1,
  width: 300,
  height: 400,
  characters: [],
  objects: [],
  blocks: [],
  readingOrder: [],
  plainText: "中文 x = 1",
  warnings: [],
  analyzedAt: 1,
});
export const cacheFixture = {
  analyses: [
    page("schema1:pdfium:native-old"),
    page("schema1:pdfium:native-new", "other-paper"),
    page("schema1:pdfium:heron-old:rules1"),
  ],
  semantics: buildDocumentSemantics("cache-paper", 1, []),
  formula: {
    documentId: "cache-paper",
    id: "formula-fixture",
    candidates: { "old-provider:model": "x=1", "new-provider:model": "x=1" },
    asset: {
      formula: {
        id: "formula-fixture",
        documentId: "cache-paper",
        page: 1,
        box: [0.1, 0.2, 0.5, 0.3],
        mode: "display",
        pageWidth: 300,
        pageHeight: 400,
        blockId: "block",
        characterIndices: [],
        nativeText: "x=1",
        latex: null,
        recognition: "unrecognized",
      },
      imageDataUrl: "data:image/png;base64,fixture-only",
      width: 120,
      height: 40,
      scale: 1,
    },
  } satisfies FormulaRecord,
  preview: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  pdfBytes: [...cacheFixturePdf()],
};
export type CacheFixture = typeof cacheFixture;
