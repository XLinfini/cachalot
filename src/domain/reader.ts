import type { Box } from "./analysis";

/** A source preview shared by reader tools and the core assistant. Feature data
 * may extend this contract, but the reader never interprets that feature data. */
export interface ReaderSelection {
  documentId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  imageDataUrl: string;
  characterIndices?: number[];
}
export interface ReaderGesture {
  documentId: string;
  page: number;
  box: Box;
  imageDataUrl: string;
  mode: "rectangle" | "text";
  text?: string;
  characterIndices?: number[];
}
export function selectionPreview(gesture: ReaderGesture): ReaderSelection {
  return {
    documentId: gesture.documentId,
    page: gesture.page,
    x: gesture.box[0],
    y: gesture.box[1],
    width: gesture.box[2] - gesture.box[0],
    height: gesture.box[3] - gesture.box[1],
    text: gesture.text || "",
    imageDataUrl: gesture.imageDataUrl,
    characterIndices: gesture.characterIndices,
  };
}
