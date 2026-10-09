import type { WrappedPdfiumModule } from "@embedpdf/pdfium";
import type { Box, PdfObject } from "../../domain/analysis";
import type {
  PdfDrawingObject,
  PdfMatrix,
  PdfPageGraphics,
  PdfPathSegment,
  PdfResourceRef,
} from "../../domain/pdf-resources";
import { PAGE_FACTS_KEY } from "../../domain/model";

const identity: PdfMatrix = [1, 0, 0, 1, 0, 0];
export function multiplyPdfMatrices(p: PdfMatrix, q: PdfMatrix): PdfMatrix {
  return [
    p[0] * q[0] + p[2] * q[1],
    p[1] * q[0] + p[3] * q[1],
    p[0] * q[2] + p[2] * q[3],
    p[1] * q[2] + p[3] * q[3],
    p[0] * q[4] + p[2] * q[5] + p[4],
    p[1] * q[4] + p[3] * q[5] + p[5],
  ];
}
export function transformPdfBounds(bounds: Box, m: PdfMatrix): Box {
  const points = [
    [bounds[0], bounds[1]],
    [bounds[0], bounds[3]],
    [bounds[2], bounds[1]],
    [bounds[2], bounds[3]],
  ].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [
    Math.min(...points.map((p) => p[0])),
    Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])),
    Math.max(...points.map((p) => p[1])),
  ];
}
export function pdfResourceRef(
  documentId: string,
  page: number,
  kind: PdfResourceRef["kind"],
  objectPath?: number[],
): PdfResourceRef {
  return {
    documentId,
    factsKey: PAGE_FACTS_KEY,
    page,
    kind,
    ...(objectPath ? { objectPath: [...objectPath] } : {}),
  };
}

/** All handles are borrowed from the caller's live page. No pointers leave this adapter. */
export function extractPdfGraphics(
  api: WrappedPdfiumModule,
  page: number,
  textPage: number,
  number: number,
  documentId: string,
  normalize: (left: number, bottom: number, right: number, top: number) => Box,
): { graphics: PdfPageGraphics; objectPaths: Map<number, number[]> } {
  const memory = api.pdfium.wasmExports.malloc(256);
  if (!memory) throw new Error("PDF graphics allocation failed");
  const objectPaths = new Map<number, number[]>();
  const chars = new Map<number, number[]>();
  for (let i = 0; i < api.FPDFText_CountChars(textPage); i++) {
    if (api.FPDFText_IsGenerated(textPage, i)) continue;
    const handle = api.FPDFText_GetTextObject(textPage, i);
    const values = chars.get(handle) ?? [];
    values.push(i);
    chars.set(handle, values);
  }
  const f = (offset = 0) => api.pdfium.getValue(memory + offset, "float");
  const u = (offset = 0) => api.pdfium.getValue(memory + offset, "i32") >>> 0;
  const heap = () => (api.pdfium as typeof api.pdfium & { HEAPU8: Uint8Array }).HEAPU8;
  const string = (read: (buffer: number, length: number) => number, utf16 = false) => {
    const size = read(0, 0);
    if (!size || size > 1024 * 1024) return "";
    const buffer = api.pdfium.wasmExports.malloc(size);
    if (!buffer) throw new Error("PDF string allocation failed");
    try {
      read(buffer, size);
      return new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(
        heap().slice(buffer, buffer + size - (utf16 ? 2 : 1)),
      );
    } finally {
      api.pdfium.wasmExports.free(buffer);
    }
  };
  const limitations = [
    "PDFium does not expose original encoded glyph IDs, blend modes or the complete resource dictionary. Use native PDF resources to preserve them.",
    "Nested object PDF exports preserve their entire outer Form group; inspect contentIsolation and preservedObjectPath.",
  ];
  let objects = 0,
    segments = 0;
  let truncated = false;
  const path = (count: number, at: (index: number) => number): PdfPathSegment[] => {
    if (count < 0 || count > 250000 - segments) {
      truncated = true;
      limitations.push(
        "Structured path segment limit reached; native page retains complete content.",
      );
      return [];
    }
    segments += count;
    return Array.from({ length: count }, (_, i) => {
      const segment = at(i),
        kind = api.FPDFPathSegment_GetType(segment);
      if (!api.FPDFPathSegment_GetPoint(segment, memory, memory + 4))
        throw new Error("PDF path point unavailable");
      return {
        kind: kind === 2 ? "move" : kind === 1 ? "bezier" : "line",
        point: [f(), f(4)],
        close: !!api.FPDFPathSegment_GetClose(segment),
      };
    });
  };
  const kinds: Record<number, PdfObject["kind"]> = {
    1: "text",
    2: "path",
    3: "image",
    4: "shading",
    5: "form",
  };
  const visit = (
    handle: number,
    objectPath: number[],
    parent: PdfMatrix,
    ancestors: Set<number>,
  ): PdfDrawingObject | null => {
    if (++objects > 50000 || objectPath.length > 32 || ancestors.has(handle)) {
      truncated = true;
      limitations.push(
        "Structured Form/object limit reached; native page retains complete content.",
      );
      return null;
    }
    objectPaths.set(handle, objectPath);
    const kind = kinds[api.FPDFPageObj_GetType(handle)] ?? "unknown";
    const matrix: PdfMatrix = api.FPDFPageObj_GetMatrix(handle, memory)
      ? [f(), f(4), f(8), f(12), f(16), f(20)]
      : [...identity];
    const pageMatrix = multiplyPdfMatrices(parent, matrix);
    const bounds: Box = api.FPDFPageObj_GetBounds(
      handle,
      memory,
      memory + 4,
      memory + 8,
      memory + 12,
    )
      ? [f(), f(4), f(8), f(12)]
      : [0, 0, 0, 0];
    const worldBounds = transformPdfBounds(bounds, parent);
    const item: PdfDrawingObject = {
      path: objectPath,
      kind,
      box: normalize(...worldBounds),
      bounds,
      matrix,
      pageMatrix,
      resource: pdfResourceRef(documentId, number, "object-pdf", objectPath),
      active: api.FPDFPageObj_GetIsActive(handle, memory) ? !!u() : true,
      hasTransparency: !!api.FPDFPageObj_HasTransparency(handle),
      markedContentId: api.FPDFPageObj_GetMarkedContentID(handle),
    };
    if (api.FPDFPageObj_GetFillColor(handle, memory, memory + 4, memory + 8, memory + 12))
      item.fill = [u(), u(4), u(8), u(12)];
    if (api.FPDFPageObj_GetStrokeColor(handle, memory, memory + 4, memory + 8, memory + 12))
      item.stroke = [u(), u(4), u(8), u(12)];
    if (api.FPDFPageObj_GetStrokeWidth(handle, memory)) item.strokeWidth = f();
    item.lineCap = api.FPDFPageObj_GetLineCap(handle);
    item.lineJoin = api.FPDFPageObj_GetLineJoin(handle);
    const dashCount = api.FPDFPageObj_GetDashCount(handle);
    if (dashCount >= 0 && dashCount < 1024) {
      const buffer = api.pdfium.wasmExports.malloc(Math.max(4, dashCount * 4));
      if (!buffer) throw new Error("PDF dash allocation failed");
      try {
        if (
          api.FPDFPageObj_GetDashArray(handle, buffer, dashCount) &&
          api.FPDFPageObj_GetDashPhase(handle, memory)
        )
          item.dash = {
            phase: f(),
            lengths: Array.from({ length: dashCount }, (_, i) =>
              api.pdfium.getValue(buffer + i * 4, "float"),
            ),
          };
      } finally {
        api.pdfium.wasmExports.free(buffer);
      }
    } else if (dashCount >= 1024) {
      truncated = true;
      limitations.push("Structured dash limit reached; native page retains complete content.");
    }
    const clip = api.FPDFPageObj_GetClipPath(handle);
    if (clip) {
      const count = api.FPDFClipPath_CountPaths(clip);
      if (count >= 0 && count < 10000)
        item.clip = Array.from({ length: count }, (_, i) =>
          path(api.FPDFClipPath_CountPathSegments(clip, i), (j) =>
            api.FPDFClipPath_GetPathSegment(clip, i, j),
          ),
        );
      else if (count >= 10000) {
        truncated = true;
        limitations.push("Structured clip limit reached; native page retains complete content.");
      }
    }
    if (kind === "path") {
      const segments = path(api.FPDFPath_CountSegments(handle), (i) =>
        api.FPDFPath_GetPathSegment(handle, i),
      );
      if (api.FPDFPath_GetDrawMode(handle, memory, memory + 4))
        item.shape = {
          segments,
          fillRule: u() === 2 ? "winding" : u() === 1 ? "alternate" : "none",
          stroke: !!u(4),
        };
    } else if (kind === "text") {
      const font = api.FPDFTextObj_GetFont(handle);
      const fontSize = api.FPDFTextObj_GetFontSize(handle, memory) ? f() : 0;
      item.text = {
        value: string((b, n) => api.FPDFTextObj_GetText(handle, textPage, b, n), true),
        characterIndices: chars.get(handle) ?? [],
        fontSize,
        renderMode: api.FPDFTextObj_GetTextRenderMode(handle),
        font: {
          name: string((b, n) => api.FPDFFont_GetBaseFontName(font, b, n)),
          family: string((b, n) => api.FPDFFont_GetFamilyName(font, b, n)),
          embedded: !!api.FPDFFont_GetIsEmbedded(font),
          flags: api.FPDFFont_GetFlags(font),
          weight: api.FPDFFont_GetWeight(font),
          resource: pdfResourceRef(documentId, number, "font-program", objectPath),
        },
      };
    } else if (kind === "image") {
      const filters = Array.from(
        { length: Math.max(0, api.FPDFImageObj_GetImageFilterCount(handle)) },
        (_, i) => string((b, n) => api.FPDFImageObj_GetImageFilter(handle, i, b, n)),
      );
      if (api.FPDFImageObj_GetImageMetadata(handle, page, memory))
        item.image = {
          width: u(),
          height: u(4),
          bitsPerPixel: u(16),
          colorSpace: u(20),
          filters,
          resource: pdfResourceRef(documentId, number, "image-stream", objectPath),
        };
    } else if (kind === "form") {
      const count = api.FPDFFormObj_CountObjects(handle),
        next = new Set(ancestors);
      next.add(handle);
      if (count >= 0 && count <= 50000)
        item.children = Array.from({ length: count }, (_, i) =>
          visit(api.FPDFFormObj_GetObject(handle, i), [...objectPath, i], pageMatrix, next),
        ).filter((x): x is PdfDrawingObject => !!x);
      else {
        truncated = true;
        limitations.push(
          "Structured Form child limit reached; native page retains complete content.",
        );
      }
    }
    return item;
  };
  try {
    const rect = (read: (...args: [number, number, number, number, number]) => boolean): Box =>
      read(page, memory, memory + 4, memory + 8, memory + 12)
        ? [f(), f(4), f(8), f(12)]
        : [0, 0, api.FPDF_GetPageWidth(page), api.FPDF_GetPageHeight(page)];
    const mediaBox = rect(api.FPDFPage_GetMediaBox),
      cropBox = rect(api.FPDFPage_GetCropBox);
    const count = api.FPDFPage_CountObjects(page);
    const drawings = Array.from({ length: Math.min(count, 50000) }, (_, i) =>
      visit(api.FPDFPage_GetObject(page, i), [i], identity, new Set()),
    ).filter((x): x is PdfDrawingObject => !!x);
    if (count > 50000) {
      truncated = true;
      limitations.push(
        "Structured page object limit reached; native page retains complete content.",
      );
    }
    const graphics: PdfPageGraphics = {
      coordinateSpace: "pdf-user-space",
      rotation: (api.FPDFPage_GetRotation(page) * 90) as PdfPageGraphics["rotation"],
      mediaBox,
      cropBox,
      preservation: "native-page",
      truncated,
      pageResource: pdfResourceRef(documentId, number, "page-pdf"),
      objects: drawings,
      limitations: [...new Set(limitations)],
    };
    // Keep resource bytes lazy and bound serialized graphics for SQLite's 20 MiB
    // page envelope. A very large vector page remains available as a native PDF.
    if (new TextEncoder().encode(JSON.stringify(graphics)).length > 8 * 1024 * 1024) {
      graphics.objects = [];
      graphics.truncated = true;
      graphics.limitations.push("Structured graphics exceed 8 MiB; use the native page resource.");
    }
    return { objectPaths, graphics };
  } finally {
    api.pdfium.wasmExports.free(memory);
  }
}
