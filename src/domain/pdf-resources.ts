import type { Box, PdfObject } from "./analysis";
import { PAGE_FACTS_KEY } from "./model";

/** PDF user-space affine transform: x'=ax+cy+e, y'=bx+dy+f. */
export type PdfMatrix = [number, number, number, number, number, number];
/** Stable source locator, never a WASM pointer or a file-system path. */
export interface PdfResourceRef {
  documentId: string;
  factsKey: string;
  page: number;
  kind: "page-pdf" | "object-pdf" | "font-program" | "image-stream";
  /** Zero-based drawing order at each level of the Form tree. */
  objectPath?: number[];
}
export interface PdfPathSegment {
  kind: "move" | "line" | "bezier";
  point: [number, number];
  close: boolean;
}
export interface PdfDrawingObject {
  path: number[];
  kind: PdfObject["kind"];
  /** Displayed normalized bounds; raw bounds and transforms remain unclamped. */
  box: Box;
  bounds: Box;
  matrix: PdfMatrix;
  /** Includes ancestor Form transforms. */
  pageMatrix: PdfMatrix;
  resource: PdfResourceRef;
  active: boolean;
  hasTransparency: boolean;
  markedContentId: number;
  fill?: [number, number, number, number];
  stroke?: [number, number, number, number];
  strokeWidth?: number;
  lineCap?: number;
  lineJoin?: number;
  dash?: { phase: number; lengths: number[] };
  /** Clip segments as returned by PDFium, in this object's containing user space. */
  clip?: PdfPathSegment[][];
  shape?: {
    segments: PdfPathSegment[];
    fillRule: "none" | "alternate" | "winding";
    stroke: boolean;
  };
  text?: {
    value: string;
    characterIndices: number[];
    fontSize: number;
    renderMode: number;
    font: {
      name: string;
      family: string;
      embedded: boolean;
      flags: number;
      weight: number;
      resource: PdfResourceRef;
    };
  };
  image?: {
    width: number;
    height: number;
    bitsPerPixel: number;
    colorSpace: number;
    filters: string[];
    resource: PdfResourceRef;
  };
  children?: PdfDrawingObject[];
}
export interface PdfPageGraphics {
  coordinateSpace: "pdf-user-space";
  rotation: 0 | 90 | 180 | 270;
  /** PDF rectangles: [left, bottom, right, top]. No normalization. */
  mediaBox: Box;
  cropBox: Box;
  /** Native page PDF preserves states/resources not decoded by public PDFium APIs.
   * geometry-only is for synthetic facts; it cannot be used to reconstruct a page. */
  preservation: "native-page" | "geometry-only";
  /** Only indicates truncation of the exposed drawing structure, not complete decoding of PDF syntax. */
  truncated: boolean;
  pageResource?: PdfResourceRef;
  objects: PdfDrawingObject[];
  limitations: string[];
}
export type PdfResource =
  | {
      ref: PdfResourceRef;
      kind: "page-pdf" | "object-pdf";
      mediaType: "application/pdf";
      bytes: Uint8Array;
      width: number;
      height: number;
      contentIsolation: "page" | "object-drawing" | "form-group";
      preservedObjectPath?: number[];
    }
  | {
      ref: PdfResourceRef;
      kind: "font-program";
      mediaType: "application/octet-stream";
      bytes: Uint8Array;
      embedded: boolean;
      name: string;
    }
  | {
      ref: PdfResourceRef;
      kind: "image-stream";
      mediaType: "application/octet-stream";
      bytes: Uint8Array;
      width: number;
      height: number;
      bitsPerPixel: number;
      colorSpace: number;
      filters: string[];
    };

export function validPdfResourceRef(value: unknown): value is PdfResourceRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as PdfResourceRef;
  return (
    typeof ref.documentId === "string" &&
    /^[a-f0-9]{64}$/.test(ref.documentId) &&
    ref.factsKey === PAGE_FACTS_KEY &&
    Number.isSafeInteger(ref.page) &&
    ref.page > 0 &&
    ["page-pdf", "object-pdf", "font-program", "image-stream"].includes(ref.kind) &&
    (ref.kind === "page-pdf"
      ? ref.objectPath === undefined
      : Array.isArray(ref.objectPath) &&
        ref.objectPath.length > 0 &&
        ref.objectPath.length <= 32 &&
        ref.objectPath.every(
          (index) => Number.isSafeInteger(index) && index >= 0 && index < 100000,
        ))
  );
}
