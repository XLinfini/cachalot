/** Persisted records exposed by application services; no UI/runtime imports. */
export interface DocumentRecord {
  id: string; // SHA-256 of the original PDF, also the analysis cache identity.
  fileName: string;
  title: string;
  pageCount: number;
  currentPage: number;
  starred: boolean;
  /** One ordinary category; favorites are an independent built-in view.
   * Missing/null values keep older libraries in Uncategorized. */
  categoryId?: string | null;
  createdAt: number; // Unix seconds; chat message timestamps use milliseconds.
  updatedAt: number;
}
export interface CategoryRecord {
  id: string;
  name: string;
  createdAt: number;
}
export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  /** Legacy stored model/OCR editor target; chat defaults use the global defaultModel setting.
   * Resolved request providers carry the currently selected model here. */
  modelId: string;
  enabled: boolean;
  hasKey: boolean;
  /** UI ownership, stored with model metadata rather than in the credential row. */
  purpose?: "llm" | "ocr";
  // Enriched by application services; persisted separately from API credentials.
  addedModels?: ModelInfo[];
}
export interface ProviderInput extends Omit<Provider, "hasKey"> {
  apiKey?: string;
}
export interface ModelInfo {
  id: string;
  ownedBy?: string;
  /** Missing values inherit the legacy provider switch until migrated. */
  enabled?: boolean;
  /** Transport/task adapter, independent of the provider's credentials.
   * Dedicated OCR models are excluded from chat and translation choices. */
  formulaOcr?: FormulaOcrProtocol;
}
export type FormulaOcrProtocol = string;
export interface ModelSelection {
  providerId: string;
  modelId: string;
}
/** Public metadata for enabled models; credentials and disabled entries are omitted. */
export interface AvailableModel extends ModelSelection {
  providerName: string;
  kind: "chat" | "ocr";
  supportsImages: boolean;
  formulaOcr?: FormulaOcrProtocol;
}
export interface ChatThread {
  id: string;
  documentId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
export interface ChatMessage {
  id: string;
  threadId: string;
  parentId: string | null;
  role: "user" | "assistant";
  content: string;
  sourcePage: number | null;
  sourceRegion: string | null;
  providerId: string | null;
  modelId: string | null;
  createdAt: number;
  images?: ChatImage[];
}
export interface ChatImage {
  id: string;
  name: string;
  contentType: string;
  dataUrl: string;
}
export interface CompletionInput {
  providerId: string;
  modelId?: string;
  messages: Array<{ role: string; content: unknown }>;
  temperature?: number;
}
