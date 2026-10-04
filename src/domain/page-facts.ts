import type { NativePage, PageFacts } from "./analysis";
import { PAGE_FACTS_KEY } from "./model";

/** Explicit field selection also strips semantic fields from legacy payloads. */
export function createPageFacts(
  documentId: string,
  page: NativePage,
  extractedAt = Date.now(),
): PageFacts {
  return {
    schemaVersion: 1,
    kind: "page-facts",
    documentId,
    cacheKey: PAGE_FACTS_KEY,
    page: page.page,
    width: page.width,
    height: page.height,
    characters: page.characters,
    objects: page.objects,
    warnings: page.warnings,
    extractedAt,
  };
}

/** Extraction order only. This index is provisional until semantic ordering is
 * available; it is never used to infer paragraphs or document roles. */
export function nativeText(page: PageFacts): string {
  return page.characters.map((character) => character.text).join("");
}
