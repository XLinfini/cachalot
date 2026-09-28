/** Original resource preservation, including shifted CropBox and all rotations. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { init } from "@embedpdf/pdfium";
import { PdfiumDocument } from "../../src/infrastructure/analysis/pdfium";
import type { Box } from "../../src/domain/analysis";
import { area, union } from "../../src/domain/geometry";
import { loadReferencePaper } from "../support/reference-paper";

const path = process.argv[2];
if (!path) throw new Error("Usage: npm run test:formula-sources -- /absolute/path/reference.pdf");
const wasm = await readFile("node_modules/@embedpdf/pdfium/dist/pdfium.wasm");
const bytes = await readFile(path);
const api = await init({ wasmBinary: wasm });
api.PDFiumExt_Init();
const memory = api.pdfium.wasmExports.malloc(bytes.length);
const heap = () => (api.pdfium as typeof api.pdfium & { HEAPU8: Uint8Array }).HEAPU8;
heap().set(bytes, memory);
const original = api.FPDF_LoadMemDocument(memory, bytes.length, "");
const pdf = await PdfiumDocument.create(
  wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
);
const { analyses: pages } = await loadReferencePaper(path);
const formula = pages[1].formulas!.find((f) => f.mode === "display")!;
const painted = (p: (typeof pages)[number]) =>
  p.characters.filter((c) => !c.generated && !/^\s+$/u.test(c.text));
const ranks = painted(pages[1]).flatMap((c, rank) =>
  formula.characterIndices.includes(c.index) ? [rank] : [],
);
await mkdir("test-results/formula-sources", { recursive: true });
try {
  for (let rotation = 0; rotation < 4; rotation++) {
    const target = api.FPDF_CreateNewDocument();
    let page = 0,
      writer = 0;
    try {
      assert.ok(api.FPDF_ImportPages(target, original, "2", 0));
      page = api.FPDF_LoadPage(target, 0);
      api.FPDFPage_SetCropBox(page, 20, 30, 590, 810);
      api.FPDFPage_SetRotation(page, rotation);
      api.FPDF_ClosePage(page);
      page = 0;
      writer = api.PDFiumExt_OpenFileWriter();
      assert.ok(api.FPDF_SaveAsCopy(target, writer, 0));
      const size = api.PDFiumExt_GetFileWriterSize(writer),
        pointer = api.pdfium.wasmExports.malloc(size);
      let input: Uint8Array;
      try {
        api.PDFiumExt_GetFileWriterData(writer, pointer, size);
        input = heap().slice(pointer, pointer + size);
      } finally {
        api.pdfium.wasmExports.free(pointer);
      }
      pdf.open(input);
      const source = pdf.extract(1);
      // Character indices can shift when PDFium regenerates whitespace after
      // rotation; select by painted-glyph rank, which retains content order.
      const chars = ranks
        .map((rank) => painted(source as (typeof pages)[number])[rank])
        .filter((c) => c && area(c.box));
      assert.ok(chars.length);
      const cropBox = union(chars.map((c) => c.box));
      const box: Box = [
        cropBox[0] - 0.5 / source.width,
        cropBox[1] - 0.5 / source.height,
        cropBox[2] + 0.5 / source.width,
        cropBox[3] + 0.5 / source.height,
      ];
      const crop = pdf.exportRegion(1, box);
      await writeFile(`test-results/formula-sources/rotation-${rotation}.pdf`, crop);
      pdf.open(crop);
      const result = pdf.extract(1);
      assert.ok(Math.abs(result.width - (box[2] - box[0]) * source.width) < 0.002);
      assert.ok(Math.abs(result.height - (box[3] - box[1]) * source.height) < 0.002);
      // PDFium synthesizes whitespace/newlines from page geometry. Only native
      // painted glyphs are invariant when the page boxes/rotation change.
      const resources = (p: typeof source) =>
        p.characters
          .filter((c) => !c.generated && !/^\s+$/u.test(c.text))
          .map((c) => [c.text === "\u0002" ? "-" : c.text, c.fontName, c.emSize]);
      assert.deepEqual(
        resources(result),
        resources(source),
        "cropping must preserve every native glyph/font/matrix, not rasterize or replace them",
      );
      assert.equal(
        result.objects.filter((o) => o.kind === "path").length,
        source.objects.filter((o) => o.kind === "path").length,
      );
    } finally {
      if (page) api.FPDF_ClosePage(page);
      if (writer) api.PDFiumExt_CloseFileWriter(writer);
      api.FPDF_CloseDocument(target);
    }
  }
  console.log(
    "Formula vector crops passed: native glyphs, fonts, paths, shifted CropBox and rotations 0/90/180/270.",
  );
} finally {
  pdf.close();
  api.FPDF_CloseDocument(original);
  api.pdfium.wasmExports.free(memory);
}
