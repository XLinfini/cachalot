import { CACHE_KINDS, type CacheKind } from "../domain/cache";

// A generation is captured when work starts, not when it eventually writes.
// Clearing while a preview/analysis/OCR job is pending cannot revive old data.
const generations = Object.fromEntries(CACHE_KINDS.map((kind) => [kind, 0])) as Record<
  CacheKind,
  number
>;
const queues = new Map<CacheKind, Promise<void>>();
export const cacheGeneration = (kind: CacheKind): number => generations[kind];
function enqueue(kind: CacheKind, action: () => Promise<void>): Promise<void> {
  const work = (queues.get(kind) || Promise.resolve()).then(action);
  queues.set(
    kind,
    work.catch(() => undefined),
  );
  return work;
}
export function writeCache(
  kind: CacheKind,
  generation: number,
  action: () => Promise<void>,
): Promise<void> {
  return enqueue(kind, async () => {
    if (generation === generations[kind]) await action();
  });
}
export function clearCacheRecords(kind: CacheKind, action: () => Promise<void>): Promise<void> {
  generations[kind]++;
  return enqueue(kind, action);
}
export async function waitForCacheWrites(): Promise<void> {
  await Promise.all(queues.values());
}
