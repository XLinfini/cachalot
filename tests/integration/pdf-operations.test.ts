import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PdfiumDocument } from "../../src/infrastructure/analysis/pdfium";
import { PAGE_FACTS_KEY } from "../../src/domain/model";
import { cacheFixturePdf } from "../fixtures/cache";
import type { SourceRef } from "../../src/domain/document-semantics";

const wasm = await readFile("node_modules/@embedpdf/pdfium/dist/pdfium.wasm");
const content =
  "BT /F1 14 Tf 30 350 Td (English prose) Tj ET\nBT /F1 14 Tf 30 300 Td (x = 1) Tj ET\n1 0 0 rg 200 200 40 40 re f\n";
const source = cacheFixturePdf(1, { content });
const documentId = createHash("sha256").update(source).digest("hex");
async function engine() {
  return PdfiumDocument.create(
    wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
  );
}
const reference = (characters: number[]): SourceRef => ({
  documentId,
  factsKey: PAGE_FACTS_KEY,
  page: 1,
  box: [0, 0, 1, 1],
  characterIndices: characters,
  objectIds: [],
});

test("PDF composition cleans original text, retains formula/path objects and inserts selectable overlays", async () => {
  const pdf = await engine();
  try {
    pdf.open(source);
    const original = pdf.extract(1);
    const characters = original.characters
      .filter((c) => c.index < "English prose".length)
      .map((c) => c.index);
    const overlay = cacheFixturePdf(1, {
      content: "BT /F1 14 Tf 30 350 Td (Translated text) Tj ET\n",
    });
    const output = await pdf.compose({
      sources: [source, overlay],
      pages: [
        {
          source: { source: 0, page: 1 },
          removeText: [reference(characters)],
          overlays: [{ source: 1, page: 1 }],
        },
      ],
    });
    assert.equal(
      createHash("sha256").update(source).digest("hex"),
      documentId,
      "source bytes stay immutable",
    );
    pdf.open(output);
    const page = pdf.extract(1),
      text = page.characters.map((c) => c.text).join("");
    assert.ok(text.includes("Translated text"), text);
    assert.ok(text.includes("x = 1"), text);
    assert.ok(!text.includes("English prose"), text);
    assert.equal(page.objects.filter((object) => object.kind === "path").length, 1);
    assert.deepEqual(pdf.inspectPages(), [{ page: 1, width: 300, height: 400 }]);
  } finally {
    pdf.close();
  }
});
test("PDF text removal rejects stale source references and partial objects before delivery", async () => {
  const pdf = await engine();
  try {
    await assert.rejects(
      pdf.compose({
        sources: [source],
        pages: [{ source: { source: 0, page: 1 }, removeText: [reference([0])] }],
      }),
      /Unsafe text removal/,
    );
    await assert.rejects(
      pdf.compose({
        sources: [source],
        pages: [
          {
            source: { source: 0, page: 1 },
            removeText: [{ ...reference([0]), documentId: "stale" }],
          },
        ],
      }),
      /source mismatch/,
    );
    await assert.rejects(
      pdf.compose({
        sources: [source],
        pages: [
          { source: { source: 0, page: 1 }, removeText: [{ ...reference([0]), factsKey: "old" }] },
        ],
      }),
      /source mismatch/,
    );
    await assert.rejects(
      pdf.compose({
        sources: [source],
        pages: [{ source: { source: 0, page: 1 }, removeText: [reference([999])] }],
      }),
      /outside page/,
    );
    pdf.open(source);
    assert.ok(
      pdf
        .extract(1)
        .characters.map((c) => c.text)
        .join("")
        .includes("English prose"),
    );
  } finally {
    pdf.close();
  }
});
test("cropped vector PDF resources stay clipped when moved onto a blank page", async () => {
  const pdf = await engine();
  try {
    pdf.open(source);
    const crop = pdf.exportRegion(1, [0.05, 0.2, 0.4, 0.3]);
    const output = await pdf.compose({
      sources: [crop],
      pages: [
        { width: 300, height: 400, overlays: [{ source: 0, page: 1, box: [0.1, 0.1, 0.45, 0.2] }] },
      ],
    });
    pdf.open(output);
    const rgb = pdf.renderRgb(1, 300);
    let red = 0;
    for (let i = 0; i < rgb.length; i += 3)
      if (rgb[i] > 200 && rgb[i + 1] < 80 && rgb[i + 2] < 80) red++;
    assert.equal(red, 0, "the red path outside the formula crop must never become visible");
    assert.ok(
      pdf.extract(1).characters.some((c) => c.text === "x"),
      "formula keeps native text resources",
    );
  } finally {
    pdf.close();
  }
});
test("composed pages keep source CropBox dimensions and rotation", async () => {
  const pdf = await engine();
  try {
    for (const rotation of [0, 90, 180, 270]) {
      const source = cacheFixturePdf(1, { content, cropBox: "20 30 280 380", rotation });
      pdf.open(source);
      const sizes = pdf.inspectPages();
      const output = await pdf.compose({
        sources: [source],
        pages: [{ source: { source: 0, page: 1 } }],
      });
      pdf.open(output);
      assert.deepEqual(pdf.inspectPages(), sizes);
      assert.ok(pdf.extract(1).characters.some((c) => c.text === "x"));
    }
  } finally {
    pdf.close();
  }
});

test("a two-dimensional inline fraction keeps native glyphs and its vector bar after relocation", async () => {
  const pdf = await engine();
  try {
    const fraction = cacheFixturePdf(1, {
      content: [
        "BT /F1 12 Tf 104 314 Td (a + b) Tj ET",
        "BT /F1 8 Tf 111 321 Td (2) Tj ET",
        "BT /F1 12 Tf 116 292 Td (c) Tj ET",
        "0 0 0 RG 1 w 100 308 m 140 308 l S",
        "1 0 0 rg 200 200 40 40 re f",
      ].join("\n"),
    });
    pdf.open(fraction);
    const originalPixels = pdf.renderRgb(1, 600);
    const crop = pdf.exportRegion(1, [0.3, 0.17, 0.5, 0.29]);
    const output = await pdf.compose({
      sources: [crop],
      pages: [
        { width: 300, height: 400, overlays: [{ source: 0, page: 1, box: [0.4, 0.4, 0.6, 0.52] }] },
      ],
    });
    pdf.open(output);
    const moved = pdf.extract(1).characters;
    assert.ok(
      ["a", "b", "2", "c"].every((text) => moved.some((char) => char.text === text)),
      "native formula characters survive without OCR",
    );
    for (const char of moved.filter((char) => ["a", "b", "2", "c"].includes(char.text))) {
      assert.ok(
        char.box[0] >= 0.4 && char.box[2] <= 0.6 && char.box[1] >= 0.4 && char.box[3] <= 0.52,
        `glyph ${char.text} belongs inside its new inline slot`,
      );
    }
    // Both pages have the same dimensions and square analysis rendering.
    // Compare only the relocated slot, including the vector fraction bar.
    const pixels = pdf.renderRgb(1, 600);
    const width = 120,
      height = 72;
    let difference = 0,
      ink = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const before = originalPixels[((102 + y) * 600 + 180 + x) * 3];
        const after = pixels[((240 + y) * 600 + 240 + x) * 3];
        difference += Math.abs(before - after);
        if (after < 128) ink++;
      }
    assert.ok(ink > 100, "relocated slot renders formula ink, not only hidden text");
    assert.ok(
      difference / (width * height) < 1,
      `formula render mean difference: ${difference / (width * height)}`,
    );
  } finally {
    pdf.close();
  }
});
