import { message } from "../../domain/messages";
import { init, type WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { Box, NativePage, PdfCharacter, PdfObject } from "../../domain/analysis";

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
    if (!this.handle) { this.close(); throw new Error(message("pdfOpen")); }
    return this.api.FPDF_GetPageCount(this.handle);
  }

  close(): void {
    if (this.handle) this.api.FPDF_CloseDocument(this.handle);
    if (this.memory) this.api.pdfium.wasmExports.free(this.memory);
    this.handle = 0;
    this.memory = 0;
  }

  private withPage<T>(number: number, action: (page: number) => T): T {
    if (!this.handle) throw new Error(message("pdfNotOpen"));
    const page = this.api.FPDF_LoadPage(this.handle, number - 1);
    if (!page) throw new Error(message("pdfPage", { page: number }));
    try { return action(page); }
    finally { this.api.FPDF_ClosePage(page); }
  }

  extract(number: number): NativePage {
    return this.withPage(number, page => {
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
          if (!api.FPDF_PageToDevice(page, 0, 0, 1000000, 1000000, 0, x, y, memory + 32, memory + 36)) throw new Error(message("pdfCoordinates"));
          return [api.pdfium.getValue(memory + 32, "i32") / 1000000, api.pdfium.getValue(memory + 36, "i32") / 1000000];
        };
        const box = (left: number, bottom: number, right: number, top: number): Box => {
          const points = [point(left, bottom), point(left, top), point(right, bottom), point(right, top)];
          const clamp = (value: number) => Math.min(1, Math.max(0, value));
          return [clamp(Math.min(...points.map(p => p[0]))), clamp(Math.min(...points.map(p => p[1]))),
            clamp(Math.max(...points.map(p => p[0]))), clamp(Math.max(...points.map(p => p[1])))];
        };
        const characters: PdfCharacter[] = [];
        let unmapped = 0;
        for (let index = 0; index < api.FPDFText_CountChars(textPage); index++) {
          const code = api.FPDFText_GetUnicode(textPage, index);
          if (!code) { unmapped++; continue; }
          if (code > 0x10ffff) continue;
          const hasBox = api.FPDFText_GetCharBox(textPage, index, memory, memory + 8, memory + 16, memory + 24);
          const fontSize = api.FPDFText_GetFontSize(textPage, index);
          const fontLength = api.FPDFText_GetFontInfo(textPage, index, memory + 96, 128, memory + 224);
          const fontName = fontLength > 0 && fontLength <= 128 ? new TextDecoder().decode(this.heap.slice(memory + 96, memory + 96 + fontLength - 1)) : "";
          const hasOrigin = api.FPDFText_GetCharOrigin(textPage, index, memory + 40, memory + 48);
          const origin = hasOrigin ? point(api.pdfium.getValue(memory + 40, "double"), api.pdfium.getValue(memory + 48, "double")) : undefined;
          const hasMatrix = api.FPDFText_GetMatrix(textPage, index, memory + 64);
          const emSize = hasMatrix ? fontSize * Math.hypot(api.pdfium.getValue(memory + 72, "float"), api.pdfium.getValue(memory + 76, "float")) : fontSize;
          characters.push({ index, text: String.fromCodePoint(code), fontSize, origin, emSize, fontName,
            italic: (api.pdfium.getValue(memory + 224, "i32") & 64) !== 0 || /italic|oblique/i.test(fontName),
            generated: api.FPDFText_IsGenerated(textPage, index) === 1,
            box: hasBox ? box(api.pdfium.getValue(memory, "double"), api.pdfium.getValue(memory + 16, "double"),
              api.pdfium.getValue(memory + 8, "double"), api.pdfium.getValue(memory + 24, "double")) : [0, 0, 0, 0] });
        }
        const kinds: Record<number, PdfObject["kind"]> = { 1: "text", 2: "path", 3: "image", 4: "shading", 5: "form" };
        const objects: PdfObject[] = [];
        for (let id = 0; id < api.FPDFPage_CountObjects(page); id++) {
          const object = api.FPDFPage_GetObject(page, id);
          if (!api.FPDFPageObj_GetBounds(object, memory, memory + 4, memory + 8, memory + 12)) continue;
          objects.push({ id, kind: kinds[api.FPDFPageObj_GetType(object)] || "unknown", box: box(
            api.pdfium.getValue(memory, "float"), api.pdfium.getValue(memory + 4, "float"),
            api.pdfium.getValue(memory + 8, "float"), api.pdfium.getValue(memory + 12, "float")) });
        }
        return { page: number, width: api.FPDF_GetPageWidth(page), height: api.FPDF_GetPageHeight(page), characters, objects,
          warnings: unmapped ? [message("unmappedCharacters", { count: unmapped })] : [] };
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
    return this.withPage(number, source => {
      const api = this.api;
      const target = api.FPDF_CreateNewDocument();
      const memory = api.pdfium.wasmExports.malloc(16);
      let page = 0, writer = 0;
      try {
        if (!target || !memory || !api.FPDF_ImportPages(target, this.handle, String(number), 0)) throw new Error(message("formulaSourceFailed"));
        const points = [[region[0], region[1]], [region[2], region[1]], [region[0], region[3]], [region[2], region[3]]].map(([x, y]) => {
          if (!api.FPDF_DeviceToPage(source, 0, 0, 1000000, 1000000, 0, Math.round(x * 1000000), Math.round(y * 1000000), memory, memory + 8)) throw new Error(message("pdfCoordinates"));
          return [api.pdfium.getValue(memory, "double"), api.pdfium.getValue(memory + 8, "double")];
        });
        page = api.FPDF_LoadPage(target, 0);
        const left = Math.min(...points.map(p => p[0])), right = Math.max(...points.map(p => p[0]));
        const bottom = Math.min(...points.map(p => p[1])), top = Math.max(...points.map(p => p[1]));
        api.FPDFPage_SetCropBox(page, left, bottom, right, top);
        api.FPDFPage_SetMediaBox(page, left, bottom, right, top);
        api.FPDF_ClosePage(page); page = 0;
        writer = api.PDFiumExt_OpenFileWriter();
        if (!writer || !api.FPDF_SaveAsCopy(target, writer, 0)) throw new Error(message("formulaSourceFailed"));
        const size = api.PDFiumExt_GetFileWriterSize(writer);
        const output = api.pdfium.wasmExports.malloc(size);
        try {
          api.PDFiumExt_GetFileWriterData(writer, output, size);
          return this.heap.slice(output, output + size);
        } finally { api.pdfium.wasmExports.free(output); }
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
    return this.withPage(number, page => {
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
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const source = pointer + y * stride + x * 4;
          const target = (y * size + x) * 3;
          rgb[target] = heap[source + 2];
          rgb[target + 1] = heap[source + 1];
          rgb[target + 2] = heap[source];
        }
        return rgb;
      } finally { api.FPDFBitmap_Destroy(bitmap); }
    });
  }
}
