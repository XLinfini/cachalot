import type { Box, PageAnalysis } from "../../domain/analysis";

export type WorkerRequest = { id: number } & (
  | { kind: "open"; bytes: ArrayBuffer; pdfiumUrl: string; modelUrl: string; documentId: string }
  | { kind: "extract"; page: number }
  | { kind: "analyze"; page: number; native?: PageAnalysis }
  | { kind: "export"; page: number; box: Box }
);
export type WorkerResponse =
  | { id: number; kind: "result"; result: PageAnalysis | number | Uint8Array }
  | { id: number; kind: "progress"; message: string }
  | { id: number; kind: "error"; error: string };
