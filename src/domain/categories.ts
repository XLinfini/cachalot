import { message } from "./messages";

export const CATEGORY_NAME_LIMIT = 80;
export type LibraryFilter = "all" | "recent" | "starred" | "uncategorized" | { categoryId: string };
const reservedNames = new Set([
  "未分类论文",
  "uncategorized papers",
  "收藏",
  "我的收藏",
  "favorites",
]);

/** Validate at the storage boundary; category names are user data,
 * while built-in views are translated at render time and never persisted. */
export function categoryName(value: string): string {
  const name = value.trim();
  if (!name) throw new Error(message("categoryNameRequired"));
  if ([...name].length > CATEGORY_NAME_LIMIT)
    throw new Error(message("categoryNameTooLong", { limit: CATEGORY_NAME_LIMIT }));
  if (reservedNames.has(name.toLowerCase())) throw new Error(message("categoryNameReserved"));
  return name;
}
