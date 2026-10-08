import { message } from "../../domain/messages";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { Box, NativePage, PdfCharacter, PdfObject } from "../../domain/analysis";
import type { PdfComposition, PdfPageInfo } from "../../domain/document-workbench";
import { PAGE_FACTS_KEY } from "../../domain/model";
import { validBox } from "../../domain/pdf-comparison";
import type { PdfResource, PdfResourceRef } from "../../domain/pdf-resources";
import { validPdfResourceRef } from "../../domain/pdf-resources";
import { extractPdfGraphics } from "./pdfium-graphics";

/** Owns all PDFium handles. Only use from one serialized worker queue. */
export class PdfiumDocument {
  private handle = 0;
  private memory = 0;
  private byteLength = 0;

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
    this.byteLength = bytes.length;
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
    this.byteLength = 0;
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
    if (
      !Number.isSafeInteger(number) ||
      number < 1 ||
      number > this.api.FPDF_GetPageCount(this.handle)
    )
      throw new Error("Invalid PDF page");
    const page = this.api.FPDF_LoadPage(this.handle, number - 1);
    if (!page) throw new Error(message("pdfPage", { page: number }));
    try {
      return action(page);
    } finally {
      this.api.FPDF_ClosePage(page);
    }
  }

  extract(number: number, documentId = ""): NativePage {
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
        const { graphics, objectPaths } = extractPdfGraphics(
          api,
          page,
          textPage,
          number,
          documentId,
          box,
        );
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
          const generated = api.FPDFText_IsGenerated(textPage, index) === 1;
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
            generated,
            objectPath: generated
              ? undefined
              : objectPaths.get(api.FPDFText_GetTextObject(textPage, index)),
            pdfOrigin: hasOrigin
              ? [
                  api.pdfium.getValue(memory + 40, "double"),
                  api.pdfium.getValue(memory + 48, "double"),
                ]
              : undefined,
            matrix: hasMatrix
              ? ([0, 4, 8, 12, 16, 20].map((offset) =>
                  api.pdfium.getValue(memory + 64 + offset, "float"),
                ) as PdfCharacter["matrix"])
              : undefined,
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
          graphics,
          warnings: unmapped ? [message("unmappedCharacters", { count: unmapped })] : [],
        };
      } finally {
        api.FPDFText_ClosePage(textPage);
        api.pdfium.wasmExports.free(memory);
      }
    });
  }

  /** Resolve only against the exact source/extractor that issued the locator. */
  async resolveResource(ref: PdfResourceRef): Promise<PdfResource> {
    if (!this.handle || !validPdfResourceRef(ref))
      throw new Error("Invalid PDF resource reference");
    ref = structuredClone(ref);
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          this.heap.slice(this.memory, this.memory + this.byteLength).buffer,
        ),
      ),
    ]
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== ref.documentId) throw new Error("PDF resource source mismatch");
    return this.withPage(ref.page, (page) => {
      const api = this.api;
      let object = 0;
      for (const [depth, index] of (ref.objectPath ?? []).entries()) {
        const count = depth
          ? api.FPDFFormObj_CountObjects(object)
          : api.FPDFPage_CountObjects(page);
        if (index >= count || (depth && api.FPDFPageObj_GetType(object) !== 5))
          throw new Error("PDF resource object path unavailable");
        object = depth
          ? api.FPDFFormObj_GetObject(object, index)
          : api.FPDFPage_GetObject(page, index);
        if (!object) throw new Error("PDF resource object unavailable");
      }
      if (ref.kind === "page-pdf" || ref.kind === "object-pdf")
        return {
          ref,
          kind: ref.kind,
          mediaType: "application/pdf",
          bytes: this.exportDrawing(ref.page, ref.objectPath),
          width: api.FPDF_GetPageWidth(page),
          height: api.FPDF_GetPageHeight(page),
          contentIsolation:
            ref.kind === "page-pdf"
              ? "page"
              : ref.objectPath!.length > 1
                ? "form-group"
                : "object-drawing",
          ...(ref.objectPath ? { preservedObjectPath: [ref.objectPath[0]] } : {}),
        };
      const memory = api.pdfium.wasmExports.malloc(32);
      if (!memory) throw new Error("PDF resource allocation failed");
      const binary = (
        length: number,
        read: (buffer: number, length: number) => boolean | number,
      ) => {
        if (!Number.isSafeInteger(length) || length <= 0 || length > 128 * 1024 * 1024)
          throw new Error("PDF resource unavailable or exceeds 128 MiB");
        const buffer = api.pdfium.wasmExports.malloc(length);
        if (!buffer) throw new Error("PDF resource allocation failed");
        try {
          if (!read(buffer, length)) throw new Error("PDF resource read failed");
          return this.heap.slice(buffer, buffer + length);
        } finally {
          api.pdfium.wasmExports.free(buffer);
        }
      };
      const string = (read: (buffer: number, length: number) => number) => {
        const length = read(0, 0);
        if (!length) return "";
        return new TextDecoder().decode(binary(length, read).subarray(0, length - 1));
      };
      try {
        if (ref.kind === "font-program") {
          if (api.FPDFPageObj_GetType(object) !== 1)
            throw new Error("PDF font resource requires a text object");
          const font = api.FPDFTextObj_GetFont(object);
          if (!api.FPDFFont_GetFontData(font, 0, 0, memory))
            throw new Error("PDF font program unavailable");
          const length = api.pdfium.getValue(memory, "i32") >>> 0;
          const bytes = binary(length, (buffer, size) =>
            api.FPDFFont_GetFontData(font, buffer, size, memory),
          );
          return {
            ref,
            kind: ref.kind,
            mediaType: "application/octet-stream",
            bytes,
            embedded: !!api.FPDFFont_GetIsEmbedded(font),
            name: string((b, n) => api.FPDFFont_GetBaseFontName(font, b, n)),
          };
        }
        if (api.FPDFPageObj_GetType(object) !== 3)
          throw new Error("PDF image resource requires an image object");
        if (!api.FPDFImageObj_GetImageMetadata(object, page, memory))
          throw new Error("PDF image metadata unavailable");
        const u = (offset: number) => api.pdfium.getValue(memory + offset, "i32") >>> 0;
        const width = u(0),
          height = u(4),
          bitsPerPixel = u(16),
          colorSpace = u(20);
        const filters = Array.from(
          { length: Math.max(0, api.FPDFImageObj_GetImageFilterCount(object)) },
          (_, i) => string((b, n) => api.FPDFImageObj_GetImageFilter(object, i, b, n)),
        );
        const length = api.FPDFImageObj_GetImageDataRaw(object, 0, 0);
        return {
          ref,
          kind: ref.kind,
          mediaType: "application/octet-stream",
          bytes: binary(length, (b, n) => api.FPDFImageObj_GetImageDataRaw(object, b, n)),
          width,
          height,
          bitsPerPixel,
          colorSpace,
          filters,
        };
      } finally {
        api.pdfium.wasmExports.free(memory);
      }
    });
  }

  /** A self-contained page PDF; nested object exports retain the entire outer Form.
   * PDFium re-applies /Matrix when regenerating modified Form streams. Keep
   * those streams intact rather than silently shifting glyphs/clips or losing states.
   * Other drawings are removed, but unused resource bytes may remain (not redaction). */
  private exportDrawing(number: number, path?: number[]): Uint8Array {
    const api = this.api,
      target = api.FPDF_CreateNewDocument();
    let page = 0,
      writer = 0;
    try {
      if (!target || !api.FPDF_ImportPages(target, this.handle, String(number), 0))
        throw new Error("PDF resource import failed");
      page = api.FPDF_LoadPage(target, 0);
      if (!page) throw new Error("PDF resource page unavailable");
      if (path) {
        const count = api.FPDFPage_CountObjects(page);
        if (path[0] >= count) throw new Error("PDF resource import changed object path");
        for (let i = count - 1; i >= 0; i--) {
          if (i === path[0]) continue;
          const object = api.FPDFPage_GetObject(page, i);
          const removed = api.FPDFPage_RemoveObject(page, object);
          if (!removed) throw new Error("PDF resource drawing removal failed");
          api.FPDFPageObj_Destroy(object);
        }
        for (let i = api.FPDFPage_GetAnnotCount(page) - 1; i >= 0; i--)
          if (!api.FPDFPage_RemoveAnnot(page, i))
            throw new Error("PDF resource annotation removal failed");
        if (!api.FPDFPage_GenerateContent(page))
          throw new Error("PDF resource content generation failed");
      }
      api.FPDF_ClosePage(page);
      page = 0;
      writer = api.PDFiumExt_OpenFileWriter();
      if (!writer || !api.FPDF_SaveAsCopy(target, writer, 0))
        throw new Error("PDF resource write failed");
      const length = api.PDFiumExt_GetFileWriterSize(writer);
      if (length <= 0 || length > 256 * 1024 * 1024)
        throw new Error("PDF resource exceeds 256 MiB");
      const buffer = api.pdfium.wasmExports.malloc(length);
      if (!buffer) throw new Error("PDF resource allocation failed");
      try {
        api.PDFiumExt_GetFileWriterData(writer, buffer, length);
        return this.heap.slice(buffer, buffer + length);
      } finally {
        api.pdfium.wasmExports.free(buffer);
      }
    } finally {
      if (page) api.FPDF_ClosePage(page);
      if (writer) api.PDFiumExt_CloseFileWriter(writer);
      if (target) api.FPDF_CloseDocument(target);
    }
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
