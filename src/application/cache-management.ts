import { cacheRepository } from "../infrastructure/cache-management";
import type { CacheKind, CacheUsage } from "../domain/cache";

/** UI-neutral cache management for browser and desktop. Clearing is global
 * across papers and parser/model versions, never a deletion of user content. */
export const cacheManagement = {
  usage: (): Promise<CacheUsage[]> => cacheRepository.usage(),
  clear: (kind: CacheKind): Promise<void> => cacheRepository.clear(kind),
};
