import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import { en } from "../fixtures/locales";
import { zh } from "../fixtures/locales";
import { CACHE_KINDS } from "../../src/domain/cache";
import { cacheFixture } from "../fixtures/cache";
import { seedCaches } from "../support/seed-caches";

for (const language of ["zh", "en"] as const) {
  test(`Cache settings: individual clear, preservation and preview regeneration (${language})`, async () => {
    const labels = language === "zh" ? zh : en;
    const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
    const context = await browser.newContext({
      viewport: { width: language === "zh" ? 1440 : 1194, height: language === "zh" ? 1000 : 834 },
    });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript((language) => {
        if (!localStorage.getItem("cachalot:setting:uiLanguage"))
          localStorage.setItem("cachalot:setting:uiLanguage", language);
      }, language);
      await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
      // Open settings first: library covers must not write during fixture seeding.
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      await page.evaluate(seedCaches, cacheFixture);
      await page.evaluate(
        (language) => localStorage.setItem("cachalot:setting:uiLanguage", language),
        language,
      );
      await page.reload();
      await expect(page.locator('[data-ui="document-card"] img')).toHaveAttribute(
        "src",
        /^data:image\//,
      );
      const openCacheSettings = async () => {
        await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
        await page.getByRole("button", { name: labels.cache.title, exact: true }).click();
      };
      await openCacheSettings();
      const main = page.locator('[data-ui="cache-settings"]');
      await expect(main.locator('[data-ui="cache-total"]')).not.toHaveText("—");
      await expect(main.locator('[data-ui="cache-total"]')).not.toHaveText("0 B");
      await expect(
        main.locator('[data-cache-kind="native"] [data-ui="cache-count"]'),
      ).toContainText("2");
      await expect(
        main.locator('[data-cache-kind="formulas"] [data-ui="cache-count"]'),
      ).toContainText("2");
      const snapshot = await page.evaluate(() =>
        Object.fromEntries(
          Object.entries(localStorage).filter(
            ([key]) =>
              !key.startsWith("cachalot:page:") && !key.startsWith("cachalot:setting:preview:"),
          ),
        ),
      );
      await mkdir("test-results/cache-settings", { recursive: true });
      await page.screenshot({ path: `test-results/cache-settings/${language}.png` });

      for (const kind of CACHE_KINDS) {
        const row = main.locator(`[data-cache-kind="${kind}"]`);
        const others = await main
          .locator(`[data-cache-kind]:not([data-cache-kind="${kind}"]) [data-ui="cache-size"]`)
          .allTextContents();
        await row.getByRole("button").click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toContainText(labels.cache.kinds[kind].effect);
        if (kind === "formulas") await expect(dialog).toContainText(labels.cache.scope);
        // Closing/canceling a confirmation never deletes data.
        await dialog.getByRole("button", { name: labels.common.cancel, exact: true }).click();
        await expect(row.locator('[data-ui="cache-size"]')).not.toHaveText("0 B");
        await row.getByRole("button").click();
        await dialog.getByRole("button", { name: labels.cache.clear, exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(row.locator('[data-ui="cache-size"]')).toHaveText("0 B");
        await expect(row.getByRole("button")).toBeDisabled();
        await expect(
          main.locator(`[data-cache-kind]:not([data-cache-kind="${kind}"]) [data-ui="cache-size"]`),
        ).toHaveText(others);
      }
      await expect(main.locator('[data-ui="cache-total"]')).toHaveText("0 B");
      expect(await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)))).toEqual(
        snapshot,
      );
      await main.getByRole("button", { name: labels.cache.refresh, exact: true }).click();
      await expect(main.locator('[data-ui="cache-total"]')).toHaveText("0 B");
      await page.reload();
      // Reload returns to the library; cleared previews regenerate from the PDF.
      await expect(page.locator('[data-ui="document-card"] img')).toHaveAttribute(
        "src",
        /^data:image\//,
      );
      await openCacheSettings();
      await expect(
        main.locator('[data-cache-kind="previews"] [data-ui="cache-count"]'),
      ).toContainText("1");
      for (const kind of CACHE_KINDS.filter((kind) => kind !== "previews"))
        await expect(main.locator(`[data-cache-kind="${kind}"] [data-ui="cache-size"]`)).toHaveText(
          "0 B",
        );
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
