import assert from "node:assert/strict";
import { test } from "node:test";
import { browserCategories as categories } from "../../src/infrastructure/browser-categories";
import { parseMessage } from "../../src/domain/messages";

const data = new Map<string, string>();
let blocked = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => data.get(key) || null,
    setItem: (key: string, value: string) => {
      if (blocked) throw new DOMException("Storage full", "QuotaExceededError");
      data.set(key, value);
    },
  },
});

test("category deletion and failed writes preserve memberships and unrelated library data", () => {
  assert.deepEqual(categories.list(), []);
  assert.deepEqual(categories.assignments(), {});
  data.set("cachalot:documents", "fixture-paper-and-progress");
  data.set("cachalot:threads", "fixture-conversations");
  const first = categories.create("  Circuits  ");
  const second = categories.create("Control");
  assert.equal(first.name, "Circuits");
  categories.move("one", first.id);
  categories.move("two", second.id);
  const saved = data.get("cachalot:categories");
  blocked = true;
  try {
    assert.throws(() => categories.remove(first.id), /Storage full/);
    assert.throws(() => categories.move("one", null), /Storage full/);
    assert.equal(data.get("cachalot:categories"), saved);
    assert.equal(categories.assignments().one, first.id);
  } finally {
    blocked = false;
  }
  categories.remove(first.id);
  assert.deepEqual(categories.assignments(), { two: second.id });
  assert.deepEqual(
    categories.list().map((entry) => entry.id),
    [second.id],
  );
  assert.equal(data.get("cachalot:documents"), "fixture-paper-and-progress");
  assert.equal(data.get("cachalot:threads"), "fixture-conversations");
  categories.move("two", null);
  assert.deepEqual(categories.assignments(), {});
});

test("reserved/duplicate names and missing targets fail without changing saved state", () => {
  const saved = data.get("cachalot:categories");
  const rejects = (work: () => unknown, code: string) =>
    assert.throws(work, (cause) => parseMessage(String(cause))?.code === code);
  rejects(() => categories.create(" control "), "categoryNameDuplicate");
  rejects(() => categories.create(" "), "categoryNameRequired");
  rejects(() => categories.create("x".repeat(81)), "categoryNameTooLong");
  for (const name of ["未分类论文", "我的收藏", "收藏", "Favorites", "Uncategorized papers"])
    rejects(() => categories.create(name), "categoryNameReserved");
  rejects(() => categories.move("one", "missing"), "categoryNotFound");
  // Built-in views are virtual and cannot be deleted through the adapter.
  for (const id of ["starred", "uncategorized"])
    rejects(() => categories.remove(id), "categoryNotFound");
  assert.equal(data.get("cachalot:categories"), saved);
});
