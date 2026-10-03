/** Regenerable document data only; original PDFs and user data are excluded. */
export const CACHE_KINDS = ["native", "layout", "pageText", "previews", "formulas"] as const;
export type CacheKind = (typeof CACHE_KINDS)[number];
export interface CacheUsage {
  kind: CacheKind;
  /** UTF-8 serialized payload bytes, excluding storage-engine overhead. */
  bytes: number;
  entries: number;
  /** All stored OCR candidates, including candidates from older models/rules. */
  candidates: number;
}
export function analysisCacheKind(key: string): "native" | "layout" | "formulas" {
  return key.startsWith("formula-assets:")
    ? "formulas"
    : key.includes(":native")
      ? "native"
      : "layout";
}
export function emptyCacheUsage(): CacheUsage[] {
  return CACHE_KINDS.map((kind) => ({ kind, bytes: 0, entries: 0, candidates: 0 }));
}
