import { message } from "../../domain/messages";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { Box, NativePage, PdfCharacter, PdfObject } from "../../domain/analysis";
import type { PdfComposition, PdfPageInfo } from "../../domain/document-workbench";
import { PAGE_FACTS_KEY } from "../../domain/model";
import { validBox } from "../../domain/pdf-comparison";

/** Owns all PDFium handles. Only use from one serialized worker queue. */
export class PdfiumDocument {
  private handle = 0;
  private memory = 0;

  private constructor(private readonly api: WrappedPdfiumModule) {}

  // Emscripten exposes this view at runtime; the package's public typings omit
  // it. Read it afresh because growing WASM memory replaces the typed array.
  private get heap(): Uint8Array {
    return (this.api.pdfium as typeof this.api.pdfium & { HEAPU8: Uint8Array }).HEAPU8;
  }

  static async create(wasmBinary: ArrayBuffer): Promise<PdfiumDocument> {
    const api = await init({ wasmBinary });
    api.PDFiumExt_Init();
    return new PdfiumDocument(api);
  }

  open(bytes: Uint8Array): number {
    this.close();
    this.memory = this.api.pdfium.wasmExports.malloc(bytes.length);
    if (!this.memory) throw new Error(message("pdfMemory"));
    this.heap.set(bytes, this.memory);
    // FPDF_LoadMemDocument borrows the buffer for the entire document lifetime.
    this.handle = this.api.FPDF_LoadMemDocument(this.memory, bytes.length, "");
    if (!this.handle) {
      this.close();
      throw new Error(message("pdfOpen"));
    }
    return this.api.FPDF_GetPageCount(this.handle);
  }

  close(): void {
    if (this.handle) this.api.FPDF_CloseDocument(this.handle);
    if (this.memory) this.api.pdfium.wasmExports.free(this.memory);
    this.handle = 0;
    this.memory = 0;
  }
  inspectPages(): PdfPageInfo[] {
    if (!this.handle) throw new Error(message("pdfNotOpen"));
    return Array.from({ length: this.api.FPDF_GetPageCount(this.handle) }, (_, index) =>
      this.withPage(index + 1, (page) => ({
        page: index + 1,
        width: this.api.FPDF_GetPageWidth(page),
        height: this.api.FPDF_GetPageHeight(page),
      })),
    );
  }

  /** Source PDFs remain immutable. Editing happens only in the new output document. */
  async compose(input: PdfComposition): Promise<Uint8Array> {
    const api = this.api;
    if (
      !input ||
      !Array.isArray(input.sources) ||
      !input.sources.length ||
      input.sources.length > 256 ||
      !Array.isArray(input.pages) ||
      !input.pages.length ||
      input.pages.length > 10000
    )
      throw new Error("Invalid PDF composition");
    const sources: { handle: number; memory: number; hash: string }[] = [];
    const target = api.FPDF_CreateNewDocument();
    const scratch = api.pdfium.wasmExports.malloc(32);
    let writer = 0;
    try {
      if (!target || !scratch) throw new Error("PDF allocation failed");
      if (
        input.sources.reduce((sum, bytes) => sum + (bytes?.byteLength ?? Infinity), 0) >
        256 * 1024 * 1024
      )
        throw new Error("PDF sources exceed 256 MiB");
      for (const bytes of input.sources) {
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > 256 * 1024 * 1024)
          throw new Error("Invalid PDF source");
        const hash = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer)),
        ]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("");
        const memory = api.pdfium.wasmExports.malloc(bytes.length);
        if (!memory) throw new Error("PDF allocation failed");
        this.heap.set(bytes, memory);
        const handle = api.FPDF_LoadMemDocument(memory, bytes.length, "");
        if (!handle) {
          api.pdfium.wasmExports.free(memory);
          throw new Error("Invalid PDF source");
        }
        sources.push({ handle, memory, hash });
      }
      const source = (ref: { source: number; page: number }) => {
        if (!ref || !Number.isInteger(ref.source) || ref.source < 0 || ref.source >= sources.length)
          throw new Error("Invalid PDF source index");
        const item = sources[ref.source];
        if (
          !Number.isInteger(ref.page) ||
          ref.page < 1 ||
          ref.page > api.FPDF_GetPageCount(item.handle)
        )
          throw new Error("Invalid PDF source page");
        return item;
      };
      for (const [index, spec] of input.pages.entries()) {
        if (
          !spec ||
          (spec.overlays !== undefined &&
            (!Array.isArray(spec.overlays) || spec.overlays.length > 10000)) ||
          (spec.removeText !== undefined &&
            (!Array.isArray(spec.removeText) || spec.removeText.length > 10000))
        )
          throw new Error("Invalid PDF page specification");
        let page = 0;
        try {
          if (spec.source) {
            const original = source(spec.source);
            if (!api.FPDF_ImportPages(target, original.handle, String(spec.source.page), index))
              throw new Error("PDF page import failed");
            page = api.FPDF_LoadPage(target, index);
            if (spec.width !== undefined || spec.height !== undefined)
              throw new Error("Imported pages keep their original dimensions");
          } else {
            if (
              !Number.isFinite(spec.width) ||
              !Number.isFinite(spec.height) ||
              spec.width! <= 0 ||
              spec.height! <= 0 ||
              spec.width! > 20000 ||
              spec.height! > 20000
            )
              throw new Error("Invalid blank page dimensions");
            page = api.FPDFPage_New(target, index, spec.width!, spec.height!);
          }
          if (!page) throw new Error("PDF output page failed");
          if (spec.removeText?.length) {
            if (!spec.source) throw new Error("Text removal requires a source page");
            const original = source(spec.source);
            const selected = new Set<number>();
            for (const ref of spec.removeText) {
              if (
                ref.documentId !== original.hash ||
                ref.factsKey !== PAGE_FACTS_KEY ||
                ref.page !== spec.source.page ||
                !Array.isArray(ref.characterIndices)
              )
                throw new Error("Text removal source mismatch");
              for (const character of ref.characterIndices) {
                if (!Number.isInteger(character) || character < 0)
                  throw new Error("Invalid source character");
                selected.add(character);
              }
            }
            const textPage = api.FPDFText_LoadPage(page);
            if (!textPage) throw new Error("PDF text unavailable");
            const objects = new Map<number, number[]>();
            const topObjects = new Set(
              Array.from({ length: api.FPDFPage_CountObjects(page) }, (_, i) =>
                api.FPDFPage_GetObject(page, i),
              ),
            );
            const removable = new Set<number>();
            try {
              const count = api.FPDFText_CountChars(textPage);
              for (const character of selected)
                if (character >= count) throw new Error("Source character outside page");
              for (let character = 0; character < count; character++) {
                if (api.FPDFText_IsGenerated(textPage, character)) continue;
                const object = api.FPDFText_GetTextObject(textPage, character);
                if (!object) {
                  if (selected.has(character)) throw new Error("Unmapped source character");
                  continue;
                }
                const chars = objects.get(object) ?? [];
                chars.push(character);
                objects.set(object, chars);
              }
              for (const [object, characters] of objects) {
                if (!characters.some((character) => selected.has(character))) continue;
                if (
                  !topObjects.has(object) ||
                  characters.some((character) => !selected.has(character))
                )
                  throw new Error("Unsafe text removal: partial or nested text object");
                removable.add(object);
              }
            } finally {
              api.FPDFText_ClosePage(textPage);
            }
            for (const object of removable) {
              if (!api.FPDFPage_RemoveObject(page, object))
                throw new Error("PDF text removal failed");
              api.FPDFPageObj_Destroy(object);
            }
          }
          for (const overlay of spec.overlays ?? []) {
            const item = source(overlay);
            const box = overlay.box ?? [0, 0, 1, 1];
            if (!validBox(box)) throw new Error("Invalid overlay box");
            const overlayPage = api.FPDF_LoadPage(item.handle, overlay.page - 1);
            if (!overlayPage) throw new Error("PDF overlay page unavailable");
            const width = api.FPDF_GetPageWidth(overlayPage),
              height = api.FPDF_GetPageHeight(overlayPage);
            api.FPDF_ClosePage(overlayPage);
            const xobject = api.FPDF_NewXObjectFromPage(target, item.handle, overlay.page - 1);
            if (!xobject) throw new Error("PDF overlay import failed");
            let object = 0;
            try {
              object = api.FPDF_NewFormObjectFromXObject(xobject);
              // New form objects have no calculated object bounds yet. The
              // imported page matrix normalizes CropBox/rotation to its page size.
              if (!object) throw new Error("PDF overlay unavailable");
              if (width <= 0 || height <= 0) throw new Error("Empty PDF overlay");
              const point = (x: number, y: number) => {
                if (
                  !api.FPDF_DeviceToPage(
                    page,
                    0,
                    0,
                    1000000,
                    1000000,
                    0,
                    Math.round(x * 1000000),
                    Math.round(y * 1000000),
                    scratch + 16,
                    scratch + 24,
                  )
                )
                  throw new Error("PDF coordinate conversion failed");
                return [
                  api.pdfium.getValue(scratch + 16, "double"),
                  api.pdfium.getValue(scratch + 24, "double"),
                ];
              };
              const bl = point(box[0], box[3]),
                br = point(box[2], box[3]),
                tl = point(box[0], box[1]);
              const a = (br[0] - bl[0]) / width,
                b = (br[1] - bl[1]) / width;
              const c = (tl[0] - bl[0]) / height,
                d = (tl[1] - bl[1]) / height;
              api.FPDFPageObj_Transform(object, a, b, c, d, bl[0], bl[1]);
              api.FPDFPage_InsertObject(page, object);
              object = 0;
            } finally {
              if (object) api.FPDFPageObj_Destroy(object);
              api.FPDF_CloseXObject(xobject);
            }
          }
          if (!api.FPDFPage_GenerateContent(page)) throw new Error("PDF content generation failed");
        } finally {
          if (page) api.FPDF_ClosePage(page);
        }
      }
      writer = api.PDFiumExt_OpenFileWriter();
      if (!writer || !api.FPDF_SaveAsCopy(target, writer, 0)) throw new Error("PDF write failed");
      const size = api.PDFiumExt_GetFileWriterSize(writer),
        output = api.pdfium.wasmExports.malloc(size);
      if (!output) throw new Error("PDF allocation failed");
      try {
        api.PDFiumExt_GetFileWriterData(writer, output, size);
        return this.heap.slice(output, output + size);
      } finally {
        api.pdfium.wasmExports.free(output);
      }
    } finally {
      if (writer) api.PDFiumExt_CloseFileWriter(writer);
      if (target) api.FPDF_CloseDocument(target);
      for (const item of sources) {
        api.FPDF_CloseDocument(item.handle);
        api.pdfium.wasmExports.free(item.memory);
      }
      if (scratch) api.pdfium.wasmExports.free(scratch);
    }
  }

  private withPage<T>(number: number, action: (page: number) => T): T {
    if (!this.handle) throw new Error(message("pdfNotOpen"));
    const page = this.api.FPDF_LoadPage(this.handle, number - 1);
    if (!page) throw new Error(message("pdfPage", { page: number }));
    try {
      return action(page);
    } finally {
      this.api.FPDF_ClosePage(page);
    }
  }

  extract(number: number): NativePage {
    return this.withPage(number, (page) => {
      const api = this.api;
      const memory = api.pdfium.wasmExports.malloc(256);
      const textPage = api.FPDFText_LoadPage(page);
      if (!memory || !textPage) {
        if (memory) api.pdfium.wasmExports.free(memory);
        if (textPage) api.FPDFText_ClosePage(textPage);
        throw new Error(message("pdfText"));
      }
      try {
        // Use PDFium's transform instead of just flipping Y. This handles CropBox
        // offsets and intrinsic page rotation as well as ordinary upright pages.
        const point = (x: number, y: number): [number, number] => {
          if (
            !api.FPDF_PageToDevice(page, 0, 0, 1000000, 1000000, 0, x, y, memory + 32, memory + 36)
          )
            throw new Error(message("pdfCoordinates"));
          return [
            api.pdfium.getValue(memory + 32, "i32") / 1000000,
            api.pdfium.getValue(memory + 36, "i32") / 1000000,
          ];
        };
        const box = (left: number, bottom: number, right: number, top: number): Box => {
          const points = [
            point(left, bottom),
            point(left, top),
            point(right, bottom),
            point(right, top),
          ];
          const clamp = (value: number) => Math.min(1, Math.max(0, value));
          return [
            clamp(Math.min(...points.map((p) => p[0]))),
            clamp(Math.min(...points.map((p) => p[1]))),
            clamp(Math.max(...points.map((p) => p[0]))),
            clamp(Math.max(...points.map((p) => p[1]))),
          ];
        };
        const characters: PdfCharacter[] = [];
        let unmapped = 0;
        for (let index = 0; index < api.FPDFText_CountChars(textPage); index++) {
          const code = api.FPDFText_GetUnicode(textPage, index);
          if (!code) {
            unmapped++;
            continue;
          }
          if (code > 0x10ffff) continue;
          const hasBox = api.FPDFText_GetCharBox(
            textPage,
            index,
            memory,
            memory + 8,
            memory + 16,
            memory + 24,
          );
          const fontSize = api.FPDFText_GetFontSize(textPage, index);
          const fontLength = api.FPDFText_GetFontInfo(
            textPage,
            index,
            memory + 96,
            128,
            memory + 224,
          );
          const fontName =
            fontLength > 0 && fontLength <= 128
              ? new TextDecoder().decode(this.heap.slice(memory + 96, memory + 96 + fontLength - 1))
              : "";
          const hasOrigin = api.FPDFText_GetCharOrigin(textPage, index, memory + 40, memory + 48);
          const origin = hasOrigin
            ? point(
                api.pdfium.getValue(memory + 40, "double"),
                api.pdfium.getValue(memory + 48, "double"),
              )
            : undefined;
          const hasMatrix = api.FPDFText_GetMatrix(textPage, index, memory + 64);
          const emSize = hasMatrix
            ? fontSize *
              Math.hypot(
                api.pdfium.getValue(memory + 72, "float"),
                api.pdfium.getValue(memory + 76, "float"),
              )
            : fontSize;
          characters.push({
            index,
            text: String.fromCodePoint(code),
            fontSize,
            origin,
            emSize,
            fontName,
            italic:
              (api.pdfium.getValue(memory + 224, "i32") & 64) !== 0 ||
              /italic|oblique/i.test(fontName),
            generated: api.FPDFText_IsGenerated(textPage, index) === 1,
            box: hasBox
              ? box(
                  api.pdfium.getValue(memory, "double"),
                  api.pdfium.getValue(memory + 16, "double"),
                  api.pdfium.getValue(memory + 8, "double"),
                  api.pdfium.getValue(memory + 24, "double"),
                )
              : [0, 0, 0, 0],
          });
        }
        const kinds: Record<number, PdfObject["kind"]> = {
          1: "text",
          2: "path",
          3: "image",
          4: "shading",
          5: "form",
        };
        const objects: PdfObject[] = [];
        for (let id = 0; id < api.FPDFPage_CountObjects(page); id++) {
          const object = api.FPDFPage_GetObject(page, id);
          if (!api.FPDFPageObj_GetBounds(object, memory, memory + 4, memory + 8, memory + 12))
            continue;
          objects.push({
            id,
            kind: kinds[api.FPDFPageObj_GetType(object)] || "unknown",
            box: box(
              api.pdfium.getValue(memory, "float"),
              api.pdfium.getValue(memory + 4, "float"),
              api.pdfium.getValue(memory + 8, "float"),
              api.pdfium.getValue(memory + 12, "float"),
            ),
          });
        }
        return {
          page: number,
          width: api.FPDF_GetPageWidth(page),
          height: api.FPDF_GetPageHeight(page),
          characters,
          objects,
          warnings: unmapped ? [message("unmappedCharacters", { count: unmapped })] : [],
        };
      } finally {
        api.FPDFText_ClosePage(textPage);
        api.pdfium.wasmExports.free(memory);
      }
    });
  }

  /** Import the original page resources and change only its visible boxes.
   * This preserves embedded fonts, paths, images and rotation; it is a crop,
   * NOT redaction (content outside the box remains in the PDF resources). */
  exportRegion(number: number, region: Box): Uint8Array {
    return this.withPage(number, (source) => {
      const api = this.api;
      const target = api.FPDF_CreateNewDocument();
      const memory = api.pdfium.wasmExports.malloc(16);
      let page = 0,
        writer = 0;
      try {
        if (!target || !memory || !api.FPDF_ImportPages(target, this.handle, String(number), 0))
          throw new Error(message("formulaSourceFailed"));
        const points = [
          [region[0], region[1]],
          [region[2], region[1]],
          [region[0], region[3]],
          [region[2], region[3]],
        ].map(([x, y]) => {
          if (
            !api.FPDF_DeviceToPage(
              source,
              0,
              0,
              1000000,
              1000000,
              0,
              Math.round(x * 1000000),
              Math.round(y * 1000000),
              memory,
              memory + 8,
            )
          )
            throw new Error(message("pdfCoordinates"));
          return [api.pdfium.getValue(memory, "double"), api.pdfium.getValue(memory + 8, "double")];
        });
        page = api.FPDF_LoadPage(target, 0);
        const left = Math.min(...points.map((p) => p[0])),
          right = Math.max(...points.map((p) => p[0]));
        const bottom = Math.min(...points.map((p) => p[1])),
          top = Math.max(...points.map((p) => p[1]));
        api.FPDFPage_SetCropBox(page, left, bottom, right, top);
        api.FPDFPage_SetMediaBox(page, left, bottom, right, top);
        api.FPDF_ClosePage(page);
        page = 0;
        writer = api.PDFiumExt_OpenFileWriter();
        if (!writer || !api.FPDF_SaveAsCopy(target, writer, 0))
          throw new Error(message("formulaSourceFailed"));
        const size = api.PDFiumExt_GetFileWriterSize(writer);
        const output = api.pdfium.wasmExports.malloc(size);
        try {
          api.PDFiumExt_GetFileWriterData(writer, output, size);
          return this.heap.slice(output, output + size);
        } finally {
          api.pdfium.wasmExports.free(output);
        }
      } finally {
        if (page) api.FPDF_ClosePage(page);
        if (writer) api.PDFiumExt_CloseFileWriter(writer);
        if (target) api.FPDF_CloseDocument(target);
        if (memory) api.pdfium.wasmExports.free(memory);
      }
    });
  }

  /** Square RGB image: exactly the pinned Heron export's resize preprocessing. */
  renderRgb(number: number, size: number): Uint8Array {
    return this.withPage(number, (page) => {
      const api = this.api;
      const bitmap = api.FPDFBitmap_Create(size, size, 1);
      if (!bitmap) throw new Error(message("pdfBitmap"));
      try {
        api.FPDFBitmap_FillRect(bitmap, 0, 0, size, size, 0xffffffff);
        api.FPDF_RenderPageBitmap(bitmap, page, 0, 0, size, size, 0, 0);
        const pointer = api.FPDFBitmap_GetBuffer(bitmap);
        const stride = api.FPDFBitmap_GetStride(bitmap);
        const rgb = new Uint8Array(size * size * 3);
        const heap = this.heap;
        // Copy before destroying the bitmap. PDFium outputs BGRA, Heron uses RGB.
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            const source = pointer + y * stride + x * 4;
            const target = (y * size + x) * 3;
            rgb[target] = heap[source + 2];
            rgb[target + 1] = heap[source + 1];
            rgb[target + 2] = heap[source];
          }
        return rgb;
      } finally {
        api.FPDFBitmap_Destroy(bitmap);
      }
    });
  }
}
