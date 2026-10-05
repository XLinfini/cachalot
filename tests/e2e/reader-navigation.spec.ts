/** Reader teardown must finish without leaving its DOM in the library view. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import { zh } from "../fixtures/locales";
import { en } from "../fixtures/locales";
import { loadReferencePaper } from "../support/reference-paper";
import { seedPaper } from "../support/seed-paper";
import { selectRegionUnits } from "../../src/extensions/selection-translation/select-region";

test("Reader navigation @paper", async () => {
  const paper = process.env.CACHALOT_PAPER;
  if (!paper) {
    test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
    return;
  }
  const { analyses, observations, bytes } = await loadReferencePaper(paper);
  await mkdir("test-results/reader-navigation", { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
  try {
    for (const language of ["zh", "en"] as const) {
      const labels = language === "zh" ? zh : en;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
        page.on("pageerror", (error) => {
          errors.push(error.stack || error.message);
          console.error(error.stack || error.message);
        });
        page.on("console", (entry) => {
          if (entry.type() === "error") {
            errors.push(entry.text());
            console.error(entry.text());
          }
        });
        await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
        await page.evaluate(
          async ({ id, language }) => {
            const now = Math.floor(Date.now() / 1000);
            localStorage.setItem("cachalot:setting:uiLanguage", language);
            localStorage.setItem(
              "cachalot:documents",
              JSON.stringify([
                {
                  id,
                  title: "Reference paper",
                  fileName: "reference.pdf",
                  pageCount: 7,
                  currentPage: 1,
                  starred: false,
                  createdAt: now,
                  updatedAt: now,
                },
              ]),
            );
          },
          { id: analyses[0].documentId, language },
        );
        await seedPaper(page, { analyses, observations, bytes });
        await page.reload();
        const card = page.locator('[data-ui="document-card"]');
        const firstPage = page.locator('[data-ui="pdf-page"][data-page="1"]');
        const back = page.getByRole("button", { name: labels.common.library, exact: true });
        const all = page
          .locator('[data-ui="app-nav"]')
          .getByRole("button", { name: labels.nav.all, exact: true });
        // Page entry navigates the continuous reader without filtering previews.
        await card.click();
        await expect(firstPage).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
        const entry = page.getByRole("textbox", { name: labels.reader.jumpToPage, exact: true });
        const previews = page.locator('[data-ui="page-thumbnail"]');
        await expect(previews.locator("span")).toHaveText(["1", "2", "3", "4", "5", "6", "7"]);
        for (const value of ["0", "8", "2.5"]) {
          await entry.fill(value);
          await entry.press("Enter");
          await expect(entry).toHaveAttribute("aria-invalid", "true");
          await expect(previews).toHaveCount(7);
        }
        await entry.fill("07");
        await entry.press("Enter");
        await expect(previews.filter({ hasText: /^7$/ })).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator('[data-ui="pdf-page"][data-page="7"]')).toHaveAttribute(
          "data-rendered",
          "true",
          { timeout: 30_000 },
        );
        await expect(entry).toHaveValue("7");
        await expect(previews).toHaveCount(7);
        await entry.fill("1");
        await page.getByRole("button", { name: labels.reader.jumpSubmit, exact: true }).click();
        await expect(firstPage).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
        await back.click();
        for (const entry of ["header", "sidebar", "zoom", "loading"] as const) {
          await card.click();
          await expect(back).toBeVisible();
          if (entry !== "loading")
            await expect(firstPage).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
          if (entry === "zoom")
            await page.getByTitle(labels.reader.zoomIn, { exact: true }).click();
          await (entry === "sidebar" ? all : back).click();
          await page.screenshot({
            path: `test-results/reader-navigation/${language}-${entry}.png`,
          });
          assert.deepEqual(errors, [], `Unexpected browser error after ${entry} navigation`);
          await expect(card).toBeVisible();
          await expect(page.locator('[data-ui="pdf-scroll"]')).toHaveCount(0);
          // Another UI action confirms the library remains responsive.
          await page.getByRole("button", { name: labels.nav.recent, exact: true }).first().click();
          await expect(card).toBeVisible();
          await all.click();
        }
        // Verify the reader can be mounted again after all teardown paths.
        await card.click();
        await expect(firstPage).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
        assert.deepEqual(errors, []);
        console.log(`${language}: library navigation, loading/zoom teardown and reopening passed`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});

test("Whole-unit rectangle selection and overlays @paper", async () => {
  const paper = process.env.CACHALOT_PAPER;
  if (!paper) {
    test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
    return;
  }
  const { analyses, observations, bytes } = await loadReferencePaper(paper);
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
  try {
    for (const language of ["zh", "en"] as const) {
      const labels = language === "zh" ? zh : en;
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
        await page.evaluate(
          ({ id, language }) => {
            localStorage.setItem("cachalot:setting:uiLanguage", language);
            localStorage.setItem(
              "cachalot:documents",
              JSON.stringify([
                {
                  id,
                  title: "Selection fixture",
                  fileName: "reference.pdf",
                  pageCount: 7,
                  currentPage: 2,
                  starred: false,
                  createdAt: 1,
                  updatedAt: 1,
                },
              ]),
            );
          },
          { id: analyses[0].documentId, language },
        );
        await seedPaper(page, { analyses, observations, bytes });
        await page.reload();
        await page.locator('[data-ui="document-card"]').click();
        await page.locator('[data-ui="analysis-strip"][data-phase="ready"]').waitFor();
        const host = page.locator('[data-ui="pdf-page"][data-page="2"]');
        await expect(host).toHaveAttribute("data-rendered", "true");
        const units = selectRegionUnits(analyses[1], [0, 0, 1, 1]);
        const equation = units.find((unit) => unit.kind === "formula" && unit.box[1] > 0.28)!;
        const paragraph = units.find((unit) => unit.kind === "paragraph" && unit.box[1] > 0.25)!;
        const translate = page.getByRole("button", { name: labels.reader.translate });
        const overlays = host.locator('[data-ui="selected-unit"]');
        const drag = async (
          box: [number, number, number, number],
          release = true,
          reverse = false,
        ) => {
          const bounds = (await host.boundingBox())!;
          const start = reverse ? [box[2], box[3]] : [box[0], box[1]];
          const end = reverse ? [box[0], box[1]] : [box[2], box[3]];
          await page.mouse.move(
            bounds.x + start[0] * bounds.width,
            bounds.y + start[1] * bounds.height,
          );
          await page.mouse.down();
          await page.mouse.move(
            bounds.x + end[0] * bounds.width,
            bounds.y + end[1] * bounds.height,
            { steps: 8 },
          );
          if (release) await page.mouse.up();
        };
        for (const unit of [paragraph, equation]) {
          const [left, top, right, bottom] = unit.box;
          await drag([left - 0.003, top - 0.003, (left + right) / 2, bottom + 0.003]);
          await expect(overlays).toHaveCount(0);
          await expect(translate).toHaveCount(0);
          await drag([left - 0.003, top - 0.003, right + 0.003, bottom + 0.003], false, true);
          await expect(overlays).toHaveCount(1);
          await expect(overlays).toHaveAttribute("data-unit-id", unit.id);
          await expect(translate).toHaveCount(0);
          const blue = await host.locator('[data-ui="selection-box"]').evaluate((node) => ({
            border: getComputedStyle(node).borderTopColor,
            fill: getComputedStyle(node).backgroundColor,
          }));
          assert.equal(blue.border, "rgb(45, 118, 217)");
          assert.equal(blue.fill, "rgba(0, 0, 0, 0)");
          const purple = await overlays.evaluate((node) => ({
            border: getComputedStyle(node).borderTopColor,
            fill: getComputedStyle(node).backgroundColor,
          }));
          assert.equal(purple.border, "rgb(139, 92, 246)");
          assert.ok(purple.fill !== "rgba(0, 0, 0, 0)" && purple.fill !== "rgb(139, 92, 246)");
          await page.mouse.up();
          await expect(translate).toBeVisible();
        }
        await page.screenshot({ path: `test-results/reader-navigation/units-${language}.png` });
        await page.getByTitle(labels.reader.zoomIn, { exact: true }).click();
        await expect(host).toHaveAttribute("data-rendered", "true");
        await expect(overlays).toHaveCount(0);
        await expect(translate).toHaveCount(0);
        const [left, top, right, bottom] = paragraph.box;
        await drag([left - 0.003, top - 0.003, right + 0.003, bottom + 0.003]);
        await expect(overlays).toHaveCount(1);
        await expect(overlays).toHaveAttribute("data-unit-id", paragraph.id);
        await expect(translate).toBeVisible();
        await page.getByRole("button", { name: labels.reader.text, exact: true }).click();
        await expect(overlays).toHaveCount(0);
        await expect(translate).toHaveCount(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
