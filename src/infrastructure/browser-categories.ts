import type { CategoryRecord } from "../domain/records";
import { categoryName } from "../domain/categories";
import { message } from "../domain/messages";

interface CategoryState {
  categories: CategoryRecord[];
  assignments: Record<string, string>;
}
const KEY = "cachalot:categories";

function read(): CategoryState {
  const raw = localStorage.getItem(KEY);
  return raw ? JSON.parse(raw) : { categories: [], assignments: {} };
}
function write(state: CategoryState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

/** One atomic localStorage snapshot contains both names and memberships.
 * Deleting a category cannot leave papers assigned to a missing category,
 * including when storage is full. PDF bytes, chats and analysis are untouched. */
export const browserCategories = {
  list(): CategoryRecord[] {
    return read().categories;
  },
  assignments(): Record<string, string> {
    const state = read();
    const ids = new Set(state.categories.map((category) => category.id));
    return Object.fromEntries(Object.entries(state.assignments).filter(([, id]) => ids.has(id)));
  },
  create(value: string): CategoryRecord {
    const name = categoryName(value);
    const state = read();
    if (state.categories.some((category) => category.name.toLowerCase() === name.toLowerCase()))
      throw new Error(message("categoryNameDuplicate"));
    const category = { id: crypto.randomUUID(), name, createdAt: Math.floor(Date.now() / 1000) };
    write({ ...state, categories: [...state.categories, category] });
    return category;
  },
  move(documentId: string, categoryId: string | null): void {
    const state = read();
    if (categoryId !== null && !state.categories.some((category) => category.id === categoryId))
      throw new Error(message("categoryNotFound"));
    if (categoryId === null) delete state.assignments[documentId];
    else state.assignments[documentId] = categoryId;
    write(state);
  },
  remove(id: string): void {
    const state = read();
    if (!state.categories.some((category) => category.id === id))
      throw new Error(message("categoryNotFound"));
    write({
      categories: state.categories.filter((category) => category.id !== id),
      assignments: Object.fromEntries(
        Object.entries(state.assignments).filter(([, target]) => target !== id),
      ),
    });
  },
  forgetDocument(documentId: string): void {
    const state = read();
    delete state.assignments[documentId];
    write(state);
  },
};
