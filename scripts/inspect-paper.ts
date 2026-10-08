/** Run the same PDFium/model/assembly pipeline as the worker, without the UI. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { PdfiumDocument } from "../src/infrastructure/analysis/pdfium";
import { DoclingLayout } from "../src/infrastructure/analysis/docling";
import { assemblePageSemantics } from "../src/application/document-analysis/page-semantics";
import {
  buildDocumentSemantics,
  projectSemanticPage,
} from "../src/application/document-analysis/document-semantics";
import { createPageFacts } from "../src/domain/page-facts";
import { LAYOUT_OBSERVATIONS_KEY, LAYOUT_MODEL } from "../src/domain/model";
import type { LayoutObservations, PageFacts } from "../src/domain/analysis";

const path = process.argv[2];
if (!path) throw new Error("用法：npm run test:paper -- /absolute/path/paper.pdf");
const bytes = new Uint8Array(await readFile(path));
const documentId = createHash("sha256").update(bytes).digest("hex");
const wasm = await readFile(
  new URL("../node_modules/@embedpdf/pdfium/dist/pdfium.wasm", import.meta.url),
);
const pdf = await PdfiumDocument.create(
  wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
);
const start = performance.now();
const layout = await DoclingLayout.create(
  new Uint8Array(
    await readFile(new URL(`../public/models/${LAYOUT_MODEL.fileName}`, import.meta.url)),
  ),
);
const facts: PageFacts[] = [];
const observations: LayoutObservations[] = [];
try {
  const count = pdf.open(bytes);
  for (let number = 1; number <= count; number++) {
    const tick = performance.now();
    const native = createPageFacts(documentId, pdf.extract(number, documentId));
    const detections = await layout.detect(pdf.renderRgb(number, LAYOUT_MODEL.inputSize));
    const observed: LayoutObservations = {
      schemaVersion: 1,
      kind: "layout-observations",
      documentId,
      page: number,
      cacheKey: LAYOUT_OBSERVATIONS_KEY,
      detections,
      observedAt: Date.now(),
    };
    facts.push(native);
    observations.push(observed);
    const snapshot = buildDocumentSemantics(
      documentId,
      count,
      facts.map((entry, index) => assemblePageSemantics(entry, observations[index])),
    );
    const page = projectSemanticPage(snapshot, native);
    assert.ok(page.facts.characters.length, `第 ${number} 页应有原生文字`);
    assert.ok(page.blocks.length, `第 ${number} 页应有内容块`);
    const kinds = Object.fromEntries(
      [...new Set(page.blocks.map((b) => b.kind))].map((kind) => [
        kind,
        page.blocks.filter((b) => b.kind === kind).length,
      ]),
    );
    console.log(
      JSON.stringify({
        page: number,
        ms: Math.round(performance.now() - tick),
        characters: page.facts.characters.length,
        objects: page.facts.objects.length,
        kinds,
        warnings: page.warnings,
      }),
    );
  }
  const output = process.env.CACHALOT_ANALYSIS_OUTPUT || "test-results/paper-analysis.json";
  await mkdir(dirname(output), { recursive: true });
  const semantics = buildDocumentSemantics(
    documentId,
    count,
    facts.map((entry, index) => assemblePageSemantics(entry, observations[index])),
  );
  await writeFile(output, JSON.stringify({ facts, observations, semantics }, null, 2));
  console.log(
    `完成 ${count} 页，含模型初始化共 ${Math.round(performance.now() - start)} ms。结构数据：${output}`,
  );
} finally {
  pdf.close();
  await layout.dispose();
}
