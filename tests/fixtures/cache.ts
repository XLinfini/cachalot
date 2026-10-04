import { buildDocumentSemantics } from "../../src/application/document-semantics";
import type { ContentBlock, NativePage } from "../../src/domain/analysis";
import type { FormulaRecord } from "../../src/infrastructure/formula-repository";

// A valid one-page PDF makes preview regeneration testable without a real paper.
const content = "BT /F1 14 Tf 30 350 Td (Cache fixture paper) Tj ET\n";
const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
];
let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(pdf.length);
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = pdf.length;
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
  .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

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
  pdfBytes: [...new TextEncoder().encode(pdf)],
};
export type CacheFixture = typeof cacheFixture;
