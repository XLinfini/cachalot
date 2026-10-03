import type { CompletionInput, ModelInfo } from "./records";

export type OcrLabel = { zh: string; en: string };
export interface OcrFormulaInput {
  id: string;
  imageDataUrl: string;
  evidence?: unknown;
}
export interface OcrCandidate {
  id: string;
  latex: string | null;
}
export type OcrAuth =
  | { type: "header"; name: string; prefix?: string }
  | { type: "query"; name: string }
  | { type: "json"; name: string }
  | { type: "none" };
/** Adapters describe secret placement; the transport injects the saved key.
 * No adapter receives credentials, SQL handles or a Tauri command name. */
export interface OcrHttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  auth?: OcrAuth;
}
export interface OcrHttpInput extends OcrHttpRequest {
  providerId: string;
}
export interface OcrJsonResponse {
  body: unknown;
  details: string;
}
export interface OcrTransport {
  json(request: OcrHttpRequest): Promise<OcrJsonResponse>;
  complete(input: Pick<CompletionInput, "messages" | "temperature">): Promise<string>;
  models(): Promise<ModelInfo[]>;
}
export interface OcrContext {
  baseUrl: string;
  modelId: string;
  transport: OcrTransport;
}
export interface OcrPreset {
  id: string;
  name: string;
  buttonLabel: OcrLabel;
  baseUrl: string;
  models: ModelInfo[];
}
export interface OcrAdapter {
  /** Stable ID persisted on models; new vendors do not extend a central union. */
  id: string;
  label: OcrLabel;
  description?: OcrLabel;
  order?: number;
  /** Exact prefix of candidate keys; bump when recognition behavior changes. */
  cachePrefix: string;
  batchSize: number;
  requiresVision?: boolean;
  presets?: OcrPreset[];
  endpoint(baseUrl: string): string;
  listModels?(context: OcrContext): Promise<ModelInfo[]>;
  recognize(context: OcrContext, formulas: OcrFormulaInput[]): Promise<OcrCandidate[]>;
}
