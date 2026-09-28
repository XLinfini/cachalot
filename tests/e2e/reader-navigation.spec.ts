/** Reader teardown must finish without leaving its DOM in the library view. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import { zh } from "../../src/i18n/locales/zh";
import { en } from "../../src/i18n/locales/en";
import { loadReferencePaper } from "../support/reference-paper";
import { seedPaper } from "../support/seed-paper";

test("Reader navigation @paper", async () => {
  const paper = process.env.CACHALOT_PAPER;
  if (!paper) {
    test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
    return;
  }
  const { analyses, bytes } = await loadReferencePaper(paper);
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
        await seedPaper(page, { analyses, bytes });
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
