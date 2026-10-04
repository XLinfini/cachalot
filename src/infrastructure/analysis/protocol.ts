import type { Box, LayoutObservations, PageFacts } from "../../domain/analysis";

export type WorkerRequest = { id: number } & (
  | { kind: "open"; bytes: ArrayBuffer; pdfiumUrl: string; modelUrl: string; documentId: string }
  | { kind: "extract"; page: number }
  | { kind: "detect"; page: number }
  | { kind: "export"; page: number; box: Box }
);
export interface WorkerResults {
  open: number;
  extract: PageFacts;
  detect: LayoutObservations;
  export: Uint8Array;
}
export type WorkerResponse =
  | {
      [K in keyof WorkerResults]: {
        id: number;
        kind: "result";
        operation: K;
        result: WorkerResults[K];
      };
    }[keyof WorkerResults]
  | { id: number; kind: "progress"; message: string }
  | { id: number; kind: "error"; error: string };

export interface AnalysisEngine {
  readonly isDisposed: boolean;
  open(documentId: string, bytes: Uint8Array): Promise<void>;
  extract(page: number): Promise<PageFacts>;
  detect(page: number): Promise<LayoutObservations>;
  dispose(): void;
}
