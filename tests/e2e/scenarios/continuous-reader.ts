/** Continuous reader checks share the cached paper fixture with visual checks. */
import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import type { SemanticPageView } from "../../../src/domain/document-semantics";
import {
  selectRegion,
  selectRegionUnits,
} from "../../../src/extensions/selection-translation/select-region";
import type { LocaleResource } from "../../fixtures/locales";

export async function verifyContinuousReader(
  page: Page,
  analyses: SemanticPageView[],
  labels: LocaleResource,
  output: string,
  viewportWidth: number,
) {
  const hosts = page.locator('[data-ui="pdf-page"]');
  const root = page.locator('[data-ui="pdf-scroll"]');
  const pageHost = (number: number) => page.locator(`[data-ui="pdf-page"][data-page="${number}"]`);
  const title = (number: number) => labels.reader.page.replace("{{page}}", String(number));
  const active = async (number: number) => {
    await page.waitForFunction(
      ({ title }) =>
        document.querySelector(`button[title="${title}"]`)?.getAttribute("aria-pressed") === "true",
      { title: title(number) },
    );
  };
  const rendered = async (number: number) => {
    await pageHost(number).and(page.locator('[data-rendered="true"]')).waitFor();
  };
  const jump = async (number: number) => {
    await page.getByTitle(title(number), { exact: true }).click();
    await active(number);
    await rendered(number);
  };
  const geometry = () =>
    root.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        top: element.scrollTop,
        height: element.clientHeight,
        left: bounds.left,
        y: bounds.top,
        width: element.clientWidth,
        pages: [...element.querySelectorAll<HTMLElement>('[data-ui="pdf-page"]')].map((host) => {
          const box = host.getBoundingClientRect();
          return {
            number: Number(host.dataset.page),
            top: box.top - bounds.top + element.scrollTop,
            width: box.width,
            height: box.height,
          };
        }),
      };
    });
  const wheelTo = async (target: number) => {
    const before = await geometry();
    await page.mouse.move(before.left + before.width / 2, before.y + before.height / 2);
    await page.mouse.wheel(0, target - before.top);
    await page.waitForFunction((target) => {
      const element = document.querySelector('[data-ui="pdf-scroll"]')!;
      return Math.abs(element.scrollTop - target) < 2;
    }, target);
  };
  assert.equal(await hosts.count(), 7, "all pages have stable placeholders");
  const first = await geometry();
  for (let index = 1; index < first.pages.length; index++) {
    assert.ok(
      Math.abs(
        first.pages[index].top - first.pages[index - 1].top - first.pages[index - 1].height - 24,
      ) < 1,
      "pages follow one another with the same gap",
    );
  }
  const anchor = Math.min(first.height * 0.35, 240);
  await wheelTo(first.pages[1].top - anchor + 60);
  await active(2);
  await rendered(2);
  const boundary = await geometry();
  assert.ok(
    boundary.pages[0].top + boundary.pages[0].height > boundary.top,
    "previous page remains visible above",
  );
  assert.ok(boundary.pages[1].top < boundary.top + boundary.height, "next page is visible below");
  await page.screenshot({ path: `${output}/continuous-${viewportWidth}.png` });
  await wheelTo(boundary.top + 80);
  assert.ok(
    Math.abs((await geometry()).top - boundary.top - 80) < 2,
    "wheel motion is continuous, without page snapping",
  );

  await wheelTo(first.pages[2].top + first.pages[2].height * 0.3 - anchor);
  await active(3);
  const beforeZoom = await geometry();
  const fraction = (beforeZoom.top + anchor - beforeZoom.pages[2].top) / beforeZoom.pages[2].height;
  await page.getByTitle(labels.reader.zoomIn, { exact: true }).click();
  await rendered(3);
  const afterZoom = await geometry();
  assert.ok(afterZoom.pages[2].height > beforeZoom.pages[2].height);
  assert.ok(
    Math.abs(
      (afterZoom.top + anchor - afterZoom.pages[2].top) / afterZoom.pages[2].height - fraction,
    ) < 0.003,
    "zoom retains the reading location within the page",
  );
  await active(3);
  await jump(7);
  await page.waitForFunction(
    () => !document.querySelector('[data-ui="pdf-page"][data-page="1"] > canvas'),
  );
  assert.ok(
    (await hosts.locator(":scope > canvas").count()) < 5,
    "distant full-resolution canvases are released",
  );
  await page.getByTitle(labels.reader.previous, { exact: true }).click();
  await active(6);
  await rendered(6);
  await jump(2);

  // The second page's selection must use the second page's analysis and canvas.
  const second = analyses.find((analysis) => analysis.page === 2)!;
  const bounds = await pageHost(2).boundingBox();
  assert.ok(bounds);
  const body = second.blocks.find(
    (block) =>
      block.kind === "paragraph" && block.characterIndices.length > 100 && block.box[3] < 0.75,
  )!;
  assert.ok(body);
  const unit = selectRegionUnits(second, [0, 0, 1, 1]).find((unit) => unit.id === body.id)!;
  const box: [number, number, number, number] = [
    unit.box[0] - 0.003,
    unit.box[1] - 0.003,
    unit.box[2] + 0.003,
    unit.box[3] + 0.003,
  ];
  await page.mouse.move(bounds.x + box[0] * bounds.width, bounds.y + box[1] * bounds.height);
  await page.mouse.down();
  await page.mouse.move(bounds.x + box[2] * bounds.width, bounds.y + box[3] * bounds.height, {
    steps: 6,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: labels.reader.translate }).click();
  await page.locator('[data-ui="translation-source-format"]').click();
  const selected = await page.locator('[data-ui="translation-source-text"]').innerText();
  const expected = selectRegion(second, box).text;
  assert.ok(selected.length > 30);
  assert.equal(selected, expected);
  await page
    .getByRole("img", { name: labels.translation.imageAlt.replace("{{page}}", "2") })
    .waitFor();
  await page
    .locator('[data-ui="translation-result"]')
    .getByText("这是用于检查样式的译文。")
    .waitFor();
  await page.screenshot({ path: `${output}/page-two-translation-${viewportWidth}.png` });
  await page.getByRole("button", { name: labels.translation.close }).click();
  const secondTop = (await geometry()).top;
  const current = await geometry();
  await wheelTo(current.pages[2].top - anchor + 60);
  await active(3);
  await rendered(3);
  assert.equal(
    await page.getByRole("button", { name: labels.reader.translate }).count(),
    1,
    "passive scrolling preserves the source selection",
  );

  // Native copying can span pages; a translation must not combine multi-page
  // text with a screenshot from just one page.
  await page.getByRole("button", { name: labels.reader.text, exact: true }).click();
  await page.evaluate(() => {
    const start = document.querySelector(
      '[data-ui="pdf-page"][data-page="2"] .textLayer span',
    )?.firstChild;
    const end = document.querySelector(
      '[data-ui="pdf-page"][data-page="3"] .textLayer span',
    )?.firstChild;
    if (!start || !end) throw new Error("missing adjacent text layers");
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, Math.min(8, end.textContent!.length));
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    end.parentElement!.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await page
    .locator('[data-ui="reader-error"]')
    .getByText(labels.messages.singlePageSelection)
    .waitFor();
  assert.equal(await page.getByRole("button", { name: labels.reader.translate }).count(), 0);
  assert.ok((await page.evaluate(() => window.getSelection()?.toString() || "")).length > 30);
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.getByRole("button", { name: labels.reader.region, exact: true }).click();
  await wheelTo(secondTop);
  await active(2);

  // At 50% the last page is shorter than the reader viewport. A jump should
  // still report page seven when the browser clamps scrolling at the bottom.
  for (let index = 0; index < 6; index++)
    await page.getByTitle(labels.reader.zoomOut, { exact: true }).click();
  assert.equal(await page.getByTitle(labels.reader.zoomOut, { exact: true }).isDisabled(), true);
  const small = await geometry();
  await wheelTo(small.pages[1].top - anchor + 60);
  await active(2);
  await jump(7);
  assert.equal((await geometry()).pages[6].height < first.height, true);
  await jump(4);
  await jump(6);
  // The browser clamps a near-end jump when two short pages fit in the view.
  // Wait for scroll reporting to settle before checking the requested page.
  await page.evaluate(async () => {
    for (let frame = 0; frame < 3; frame++) await new Promise(requestAnimationFrame);
  });
  assert.equal(
    await page.getByTitle(title(6), { exact: true }).getAttribute("aria-pressed"),
    "true",
  );
  await jump(7);
  for (let index = 0; index < 5; index++)
    await page.getByTitle(labels.reader.zoomIn, { exact: true }).click();
  await jump(6);
  await page.waitForFunction(() =>
    JSON.parse(localStorage.getItem("cachalot:documents") || "[]").some(
      (document: { currentPage: number }) => document.currentPage === 6,
    ),
  );
  await page.reload();
  await page
    .locator(`[data-ui="document-card"][data-document-id="${analyses[0].documentId}"]`)
    .click();
  await active(6);
  await rendered(6);
  const restored = await geometry();
  assert.ok(restored.top > 1000);
  assert.ok(
    Math.abs(restored.pages[5].top - restored.top - 28) < 1,
    "reopening restores the saved page within the continuous document",
  );
  await page.screenshot({ path: `${output}/continuous-restored-${viewportWidth}.png` });
  await jump(1);
}
