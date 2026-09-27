import assert from "node:assert/strict";
import { test } from "node:test";
import type { DocumentRecord } from "../src/domain/records";
import { parseLibrarySort, sortDocuments } from "../src/domain/library-sort";

const record = (
  id: string,
  title: string,
  createdAt: number,
  updatedAt: number,
): DocumentRecord => ({
  id,
  title,
  fileName: `${id}.pdf`,
  createdAt,
  updatedAt,
  pageCount: 1,
  currentPage: 1,
  starred: false,
});
const documents = [
  record("ten", "Paper 10", 10, 99),
  record("two", "Paper 2", 30, 1),
  record("alpha", "Alpha", 20, 50),
  record("beta", "Beta", 40, 10),
];
const ids = (items: DocumentRecord[]) => items.map((item) => item.id);

test("both import orders use initial import date, independent of reading activity", () => {
  assert.deepEqual(ids(sortDocuments(documents, "imported-desc", "en-US")), [
    "beta",
    "two",
    "alpha",
    "ten",
  ]);
  assert.deepEqual(ids(sortDocuments(documents, "imported-asc", "en-US")), [
    "ten",
    "alpha",
    "two",
    "beta",
  ]);
  assert.deepEqual(
    ids(documents),
    ["ten", "two", "alpha", "beta"],
    "Sorting must not mutate the source library",
  );
});

test("name orders support natural numbers, Chinese names and deterministic ties", () => {
  assert.deepEqual(ids(sortDocuments(documents, "name-asc", "en-US")), [
    "alpha",
    "beta",
    "two",
    "ten",
  ]);
  assert.deepEqual(ids(sortDocuments(documents, "name-desc", "en-US")), [
    "ten",
    "two",
    "beta",
    "alpha",
  ]);
  const chinese = [
    record("g", "伽马", 1, 1),
    record("b", "贝塔", 1, 1),
    record("a", "阿尔法", 1, 1),
  ];
  assert.deepEqual(ids(sortDocuments(chinese, "name-asc", "zh-CN")), ["a", "b", "g"]);
  const duplicates = [record("b", "Same name", 1, 1), record("a", "Same name", 1, 1)];
  assert.deepEqual(ids(sortDocuments(duplicates, "imported-asc", "en-US")), ["a", "b"]);
  assert.deepEqual(ids(sortDocuments([...duplicates].reverse(), "imported-asc", "en-US")), [
    "a",
    "b",
  ]);
  assert.equal(parseLibrarySort(null), "imported-desc");
  assert.equal(parseLibrarySort("invalid"), "imported-desc");
  assert.equal(parseLibrarySort("name-desc"), "name-desc");
});
