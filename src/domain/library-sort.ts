import type { DocumentRecord } from "./records";

export const LIBRARY_SORTS = ["name-asc", "name-desc", "imported-desc", "imported-asc"] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];
export const DEFAULT_LIBRARY_SORT: LibrarySort = "imported-desc";
export const LIBRARY_SORT_SETTING = "librarySort";

export function parseLibrarySort(value: string | null): LibrarySort {
  return LIBRARY_SORTS.includes(value as LibrarySort)
    ? (value as LibrarySort)
    : DEFAULT_LIBRARY_SORT;
}

/** Import date is the immutable createdAt, including after duplicate imports.
 * Sorting a filtered view never mutates the stored document list. Natural name
 * ordering follows the UI locale (including Chinese collation and numerals). */
export function sortDocuments(
  documents: readonly DocumentRecord[],
  sort: LibrarySort,
  locale: string,
): DocumentRecord[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const direction = sort.endsWith("asc") ? 1 : -1;
  return [...documents].sort((a, b) => {
    const name = collator.compare(a.title || a.fileName, b.title || b.fileName);
    const primary = sort.startsWith("name") ? name : a.createdAt - b.createdAt;
    // A deterministic tie-break avoids card shuffling when timestamps match.
    const tie = name || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    return direction * (primary || tie);
  });
}
