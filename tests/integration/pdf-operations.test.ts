import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { PdfiumDocument } from "../../src/infrastructure/analysis/pdfium";
import { PAGE_FACTS_KEY } from "../../src/domain/model";
import { cacheFixturePdf, nativeGraphicsFixturePdf } from "../fixtures/cache";
import type { SourceRef } from "../../src/domain/document-semantics";
import { createPageFacts } from "../../src/domain/page-facts";
import { validPageFacts } from "../../src/infrastructure/analysis/validation";
const wasm = await readFile("node_modules/@embedpdf/pdfium/dist/pdfium.wasm");

test("enhanced facts resolve native pages, nested drawings, font programs and filtered image streams after reopening", async () => {
  const pdf = await engine(),
    bytes = nativeGraphicsFixturePdf(),
    id = createHash("sha256").update(bytes).digest("hex");
  try {
    pdf.open(bytes);
    const facts = createPageFacts(id, pdf.extract(1, id));
    assert.ok(validPageFacts(facts, id, 1));
    assert.equal(facts.schemaVersion, 2);
    assert.deepEqual(facts.graphics.mediaBox, [0, 0, 300, 400]);
    assert.deepEqual(facts.graphics.cropBox, [10, 20, 290, 390]);
    const outer = facts.graphics.objects.find((o) => o.kind === "form")!;
    const inner = outer.children!.find((o) => o.kind === "form")!;
    const text = inner.children!.find((o) => o.kind === "text")!;
    const path = inner.children!.find((o) => o.kind === "path")!;
    assert.deepEqual(text.path, [1, 0, 0]);
    assert.ok(text.text!.value.includes("Nested formula"));
    assert.deepEqual(inner.pageMatrix, [1.5, 0, 0, 1.5, 67.5, 99]);
    assert.deepEqual(text.pageMatrix, [1.5, 0, 0, 1.5, 78, 157.5]);
    assert.equal(path.shape!.stroke, true);
    assert.deepEqual(path.dash, { phase: 1, lengths: [3, 2] });
    assert.ok(inner.clip?.length, "the clip inside the outer Form applies to its child drawing");
    assert.ok(facts.characters.filter((c) => !c.generated).every((c) => c.objectPath?.length));
    const linked = facts.characters.find((c) => c.text === "N")!;
    assert.deepEqual(linked.objectPath, text.path);
    assert.ok(linked.matrix && linked.pdfOrigin);
    assert.deepEqual(linked.pdfOrigin, [78, 157.5]);
    const pixels = pdf.renderRgb(1, 360);
    const reference = JSON.parse(JSON.stringify(facts.graphics.pageResource));
    pdf.close();
    pdf.open(bytes);
    const page = await pdf.resolveResource(reference);
    assert.equal(page.kind, "page-pdf");
    pdf.open(page.bytes);
    assert.deepEqual(
      pdf.renderRgb(1, 360),
      pixels,
      "native source page round-trips with CropBox and all drawing resources",
    );
    pdf.open(bytes);
    const object = await pdf.resolveResource(text.resource);
    assert.equal(object.kind, "object-pdf");
    pdf.open(object.bytes);
    const isolated = pdf.extract(1);
    assert.ok(
      isolated.characters
        .map((c) => c.text)
        .join("")
        .includes("Nested formula"),
    );
    assert.ok(
      isolated.characters
        .map((c) => c.text)
        .join("")
        .includes("Sibling"),
    );
    if (object.kind === "object-pdf") {
      assert.equal(object.contentIsolation, "form-group");
      assert.deepEqual(object.preservedObjectPath, [1]);
    }
    assert.equal(isolated.graphics!.objects.length, 1);
    const child = isolated.graphics!.objects[0].children![0];
    assert.equal(
      child.children!.length,
      2,
      "native Form contents stay intact to preserve their transforms and states",
    );
    const copied = isolated.characters.find((c) => c.text === "N")!;
    assert.deepEqual(copied.box, linked.box, "ancestor transformations survive pruning");
    const groupPixels = pdf.renderRgb(1, 360);
    for (let y = 180; y < 252; y++)
      assert.deepEqual(
        groupPixels.subarray((y * 360 + 36) * 3, (y * 360 + 252) * 3),
        pixels.subarray((y * 360 + 36) * 3, (y * 360 + 252) * 3),
        "Form clip and vector strokes render identically after export",
      );
    pdf.open(bytes);
    const font = await pdf.resolveResource(text.text!.font.resource);
    assert.equal(font.kind, "font-program");
    assert.ok(font.bytes.length > 100);
    if (font.kind === "font-program")
      assert.equal(font.embedded, false, "substituted standard font is explicitly identified");
    const image = facts.graphics.objects.find((o) => o.kind === "image")!.image!;
    const resource = await pdf.resolveResource(image.resource);
    assert.equal(resource.kind, "image-stream");
    if (resource.kind === "image-stream") {
      assert.equal(resource.width, 2);
      assert.equal(resource.height, 1);
      assert.deepEqual(resource.filters, ["ASCIIHexDecode"]);
      assert.ok(new TextDecoder().decode(resource.bytes).includes("FF000000FF00>"));
    }
    const corrupt = structuredClone(facts);
    corrupt.graphics.objects[0].resource.documentId = "0".repeat(64);
    assert.equal(
      validPageFacts(corrupt, id, 1),
      false,
      "cache locators must belong to their facts document",
    );
    corrupt.graphics.objects[0].resource.documentId = id;
    corrupt.graphics.objects[0].matrix[0] = NaN;
    assert.equal(validPageFacts(corrupt, id, 1), false);
    await assert.rejects(
      pdf.resolveResource({ ...text.resource, documentId: "0".repeat(64) }),
      /source mismatch/,
    );
    await assert.rejects(pdf.resolveResource({ ...text.resource, factsKey: "old" }), /reference/);
    await assert.rejects(
      pdf.resolveResource({ ...text.resource, objectPath: [1, 99] }),
      /path unavailable/,
    );
    await assert.rejects(
      pdf.resolveResource({ ...text.resource, objectPath: [0, 0] }),
      /path unavailable/,
    );
    await assert.rejects(
      pdf.resolveResource({ ...text.resource, kind: "image-stream" }),
      /image object/,
    );
    await assert.rejects(pdf.resolveResource({ ...text.resource, page: 2 }), /Invalid PDF page/);
  } finally {
    pdf.close();
  }
});

test("top-level object resources isolate drawings without changing their page geometry", async () => {
  const pdf = await engine();
  try {
    pdf.open(source);
    const facts = createPageFacts(documentId, pdf.extract(1, documentId));
    const first = facts.graphics.objects[0];
    const resource = await pdf.resolveResource(first.resource);
    assert.equal(resource.kind, "object-pdf");
    if (resource.kind === "object-pdf") assert.equal(resource.contentIsolation, "object-drawing");
    pdf.open(resource.bytes);
    const exported = pdf.extract(1);
    assert.equal(exported.objects.length, 1);
    assert.equal(exported.characters.map((c) => c.text).join(""), "English prose");
    assert.deepEqual(exported.characters[0].box, facts.characters[0].box);
  } finally {
    pdf.close();
  }
});

test("native page references reconstruct rotated source pages without rasterizing drawings", async () => {
  const pdf = await engine();
  try {
    for (const rotation of [90, 180, 270]) {
      const bytes = nativeGraphicsFixturePdf(rotation),
        id = createHash("sha256").update(bytes).digest("hex");
      pdf.open(bytes);
      const facts = createPageFacts(id, pdf.extract(1, id)),
        pixels = pdf.renderRgb(1, 300);
      assert.equal(facts.graphics.rotation, rotation);
      const resource = await pdf.resolveResource(facts.graphics.pageResource!);
      const reconstructed = await pdf.compose({
        sources: [resource.bytes],
        pages: [{ source: { source: 0, page: 1 } }],
      });
      pdf.open(reconstructed);
      assert.deepEqual(pdf.renderRgb(1, 300), pixels);
      assert.ok(pdf.extract(1).characters.some((c) => c.text === "N"));
    }
  } finally {
    pdf.close();
  }
});

test("repeated Form resources have distinct drawing paths and character ownership", async () => {
  const pdf = await engine(),
    bytes = nativeGraphicsFixturePdf(0, true),
    id = createHash("sha256").update(bytes).digest("hex");
  try {
    pdf.open(bytes);
    const facts = createPageFacts(id, pdf.extract(1, id));
    const ns = facts.characters.filter((c) => c.text === "N");
    assert.equal(ns.length, 2);
    assert.deepEqual(
      ns.map((c) => c.objectPath),
      [
        [1, 0, 0],
        [3, 0, 0],
      ],
    );
    for (const character of ns) {
      const text = facts.graphics.objects[character.objectPath![0]].children![0].children![0];
      assert.ok(text.text!.characterIndices.includes(character.index));
      assert.equal(text.text!.characterIndices.length, "Nested formula".length);
      assert.deepEqual(text.pageMatrix, character.matrix);
    }
  } finally {
    pdf.close();
  }
});

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
