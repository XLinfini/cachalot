import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureScrollAnchor,
  pageAtOffset,
  pagePositions,
  restoreScrollAnchor,
  readingAnchor,
} from "../../src/components/pdf/page-layout";

const sizes = [
  { number: 1, width: 612, height: 792 },
  { number: 2, width: 792, height: 612 },
  { number: 3, width: 500, height: 1000 },
];
test("mixed page sizes retain their geometry and continuous positions", () => {
  const pages = pagePositions(sizes, 1);
  assert.equal(pages[0].top, 28);
  assert.equal(pages[1].width, 792 * 0.96);
  assert.equal(pages[2].top, 28 + (792 + 612) * 0.96 + 48);
  assert.equal(pageAtOffset(pages, -100)?.number, 1);
  assert.equal(pageAtOffset(pages, pages[1].top - 1)?.number, 1);
  assert.equal(pageAtOffset(pages, pages[1].top)?.number, 2);
  assert.equal(pageAtOffset(pages, 100_000)?.number, 3);
  assert.equal(pageAtOffset([], 0), undefined);
});
test("zoom retains the reading anchor on a landscape page", () => {
  const pages = pagePositions(sizes, 1),
    height = 820;
  const top = pages[1].top + pages[1].height * 0.4 - readingAnchor(height);
  const anchor = captureScrollAnchor(pages, top, height)!;
  assert.equal(anchor.page, 2);
  assert.ok(Math.abs(anchor.fraction - 0.4) < 1e-9);
  const zoomed = pagePositions(sizes, 1.5);
  const restored = restoreScrollAnchor(zoomed, anchor, height);
  assert.ok(
    Math.abs(restored + readingAnchor(height) - zoomed[1].top - zoomed[1].height * 0.4) < 1e-9,
  );
  assert.equal(restoreScrollAnchor(zoomed, { page: 1, fraction: 0 }, height), 0);
  assert.equal(captureScrollAnchor([], 0, height), null);
});
