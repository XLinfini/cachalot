import { cacheFixture } from "./cache";

/** Distinct one-page PDFs with identical-length text replacements, preserving
 * the fixture's stream lengths/xref offsets and exercising separate content IDs. */
const pdf = new TextDecoder().decode(new Uint8Array(cacheFixture.pdfBytes));
export const libraryImportFiles = [
  { name: "first.pdf", text: "Batch first paper  " },
  { name: "second.pdf", text: "Batch second paper " },
].map(({ name, text }) => ({
  name,
  mimeType: "application/pdf",
  bytes: new TextEncoder().encode(pdf.replace("Cache fixture paper", text)),
}));
