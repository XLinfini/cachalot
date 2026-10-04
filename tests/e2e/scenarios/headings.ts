import assert from "node:assert/strict";
import { expect, type Page, type Route } from "@playwright/test";
import type { LocaleResource } from "../../../src/i18n/locales/en";

/** Uses the real reference paper's cached overlapping title/heading detections,
 * with the parent harness's isolated profile and local translation fixture. */
export async function verifyHeadings(page: Page, labels: LocaleResource, output: string) {
  const gotoPage = async (number: number) => {
    await page
      .getByTitle(labels.reader.page.replace("{{page}}", String(number)), { exact: true })
      .click();
    await page
      .locator(`[data-ui="pdf-page"][data-page="${number}"][data-rendered="true"]`)
      .waitFor();
    await page.waitForFunction((number) => {
      const top = document
        .querySelector(`[data-ui="pdf-page"][data-page="${number}"]`)
        ?.getBoundingClientRect().top;
      return top !== undefined && top > 100 && top < 250;
    }, number);
  };
  const select = async (number: number, box: [number, number, number, number]) => {
    const bounds = (await page
      .locator(`[data-ui="pdf-page"][data-page="${number}"]`)
      .boundingBox())!;
    await page.mouse.move(bounds.x + box[0] * bounds.width, bounds.y + box[1] * bounds.height);
    await page.mouse.down();
    await page.mouse.move(bounds.x + box[2] * bounds.width, bounds.y + box[3] * bounds.height, {
      steps: 6,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: labels.reader.translate }).click();
    await expect(
      page.getByRole("button", { name: labels.translation.copy, exact: true }),
    ).toBeEnabled();
  };
  const source = page.locator('[data-ui="translation-reconstructed-source"]');
  const result = page.locator('[data-ui="translation-result"]');
  const close = () => page.getByRole("button", { name: labels.translation.close }).click();
  await gotoPage(1);
  await select(1, [0.105, 0.065, 0.895, 0.148]);
  await expect(source.locator("h1")).toHaveCount(1);
  const original = await source.locator("h1").innerText();
  assert.match(original, /^Design, Control and Performance of Tracking Power Supply/);
  await expect(result.locator("h1")).toHaveText("标题译文");
  assert.ok(!(await result.innerText().then((text) => text.includes("[[heading:"))));
  const titleStyle = await result.locator("h1").evaluate((node) => ({
    size: parseFloat(getComputedStyle(node).fontSize),
    weight: Number(getComputedStyle(node).fontWeight),
  }));
  assert.ok(titleStyle.size > 16 && titleStyle.weight >= 600);
  await page.screenshot({ path: `${output}/title.png` });

  // A model cannot silently turn the heading into prose by dropping its anchors.
  const bad = (route: Route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: "标题被当作普通段落返回。" } }] })}\n\ndata: [DONE]\n\n`,
    });
  await page.route("**/v1/chat/completions", bad);
  try {
    await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
    await expect(page.locator('[data-ui="translation-error"]')).toHaveText(
      labels.messages.headingReferencesChanged,
    );
    await expect(
      page.getByRole("button", { name: labels.translation.copy, exact: true }),
    ).toBeDisabled();
  } finally {
    await page.unroute("**/v1/chat/completions", bad);
  }
  await close();

  // A partly enclosed title is not a rectangle-selection unit.
  const bounds = (await page.locator('[data-ui="pdf-page"][data-page="1"]').boundingBox())!;
  await page.mouse.move(bounds.x + 0.105 * bounds.width, bounds.y + 0.065 * bounds.height);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 0.5 * bounds.width, bounds.y + 0.148 * bounds.height, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(page.locator('[data-ui="selected-unit"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: labels.reader.translate })).toHaveCount(0);

  await gotoPage(2);
  await select(2, [0.055, 0.216, 0.49, 0.282]);
  await expect(source.locator("h2")).toHaveCount(1);
  await expect(source.locator("h3")).toHaveCount(1);
  await expect(source.locator("h2")).toContainText("II TRACKING POWER SUPPLY");
  await expect(source.locator("h3")).toContainText("A Basic Operating Principle");
  await expect(result.locator("h2")).toHaveText("标题译文");
  await expect(result.locator("h3")).toHaveText("标题译文");
  const levels = await result
    .locator("h2,h3")
    .evaluateAll((nodes) => nodes.map((node) => parseFloat(getComputedStyle(node).fontSize)));
  assert.ok(levels[0] > levels[1] && levels[1] > 12);
  await page.screenshot({ path: `${output}/sections.png` });
  await close();
}
