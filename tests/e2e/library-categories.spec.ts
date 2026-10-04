/** Isolated browser workflow: categories, all-papers invariant and safe deletion. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import type { LayoutObservations } from "../../src/domain/analysis";
import { zh } from "../../src/i18n/locales/zh";
import { en } from "../../src/i18n/locales/en";
import { loadReferencePaper } from "../support/reference-paper";
import { seedPaper } from "../support/seed-paper";

test("Library categories @paper", async () => {
  const paper = process.env.CACHALOT_PAPER;
  if (!paper) {
    test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
    return;
  }
  const { analyses, observations, bytes } = await loadReferencePaper(paper);
  const ids = [analyses[0].documentId, "b".repeat(64), "c".repeat(64)];
  await mkdir("test-results/categories", { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
  try {
    for (const language of ["zh", "en"] as const) {
      const labels = language === "zh" ? zh : en;
      const context = await browser.newContext({
        viewport: language === "zh" ? { width: 1440, height: 900 } : { width: 1194, height: 834 },
      });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.stack || error.message));
        page.on("console", (entry) => {
          if (entry.type() === "error") errors.push(entry.text());
        });
        await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
        await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
        await page.evaluate(
          async ({ ids, language }) => {
            const now = Math.floor(Date.now() / 1000);
            localStorage.setItem("cachalot:setting:uiLanguage", language);
            // Legacy metadata deliberately has no categoryId.
            localStorage.setItem(
              "cachalot:documents",
              JSON.stringify(
                ids.map((id, index) => ({
                  id,
                  title: `Reference ${index + 1}`,
                  fileName: `reference-${index + 1}.pdf`,
                  pageCount: 7,
                  currentPage: 2,
                  starred: index === 1,
                  createdAt: now,
                  updatedAt: now,
                })),
              ),
            );
            localStorage.setItem(
              "cachalot:threads",
              JSON.stringify([
                {
                  id: "thread-fixture",
                  documentId: ids[0],
                  title: "Existing discussion",
                  createdAt: now,
                  updatedAt: now,
                },
              ]),
            );
          },
          { ids, language },
        );
        await seedPaper(page, { analyses, observations, bytes, aliases: ids });
        await page.reload();
        const cards = page.locator('[data-ui="document-card"]');
        const primary = cards.filter({
          has: page.getByRole("heading", { name: "Reference 1", exact: true }),
        });
        const nav = page.locator('[data-ui="app-nav"]');
        const all = () => nav.getByRole("button", { name: labels.nav.all, exact: true }).click();
        const uncategorized = () => page.locator('[data-ui="uncategorized-category"]').click();
        const favorites = () => page.locator('[data-ui="favorites-category"]').click();
        const menu = page.locator('[data-ui="action-menu"]');
        const actions = async () => {
          await primary.hover();
          await primary.locator('[data-ui="document-actions"]').click();
        };
        const a = language === "zh" ? "电力电子" : "Power electronics";
        const b = language === "zh" ? "控制理论" : "Control theory";
        const categoryRow = (name: string) =>
          page
            .locator('[data-ui="category-row"]')
            .filter({ has: page.getByRole("button", { name, exact: true }) });
        const selectCategory = (name: string) =>
          categoryRow(name).getByRole("button", { name, exact: true }).click();
        const create = async (name: string) => {
          await page.getByRole("button", { name: labels.categories.create, exact: true }).click();
          const dialog = page.getByRole("dialog", { name: labels.categories.create, exact: true });
          await dialog
            .getByRole("textbox", { name: labels.categories.name, exact: true })
            .fill(name);
          await dialog
            .getByRole("button", { name: labels.categories.createSubmit, exact: true })
            .click();
          await expect(dialog).toHaveCount(0);
          await expect(categoryRow(name)).toBeVisible();
        };
        const move = async (name: string) => {
          await actions();
          await menu.getByRole("menuitem", { name: labels.categories.move, exact: true }).click();
          const dialog = page.getByRole("dialog");
          await dialog.getByRole("radio", { name, exact: true }).check();
          await page.screenshot({ path: `test-results/categories/${language}-move.png` });
          await dialog
            .getByRole("button", { name: labels.categories.moveSubmit, exact: true })
            .click();
          await expect(dialog).toHaveCount(0);
        };
        await expect(cards).toHaveCount(3);
        await uncategorized();
        await expect(cards).toHaveCount(3);
        await favorites();
        await expect(cards).toHaveCount(1);
        await expect(
          page.locator('[data-ui="favorites-category"] [data-ui="category-actions"]'),
        ).toHaveCount(0);
        await expect(
          page.locator('[data-ui="uncategorized-category"] [data-ui="category-actions"]'),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: labels.nav.starred, exact: true }),
        ).toHaveCount(1);

        // Reject a built-in name in the form, then create both ordinary categories.
        await page.getByRole("button", { name: labels.categories.create, exact: true }).click();
        const createDialog = page.getByRole("dialog");
        await expect(
          createDialog.getByRole("button", { name: labels.categories.createSubmit, exact: true }),
        ).toBeDisabled();
        await createDialog.getByRole("textbox").fill(labels.nav.starred);
        await createDialog
          .getByRole("button", { name: labels.categories.createSubmit, exact: true })
          .click();
        await expect(createDialog.getByRole("alert")).toHaveText(
          labels.messages.categoryNameReserved,
        );
        await createDialog.getByRole("textbox").fill(a);
        await page.screenshot({ path: `test-results/categories/${language}-create.png` });
        await createDialog
          .getByRole("button", { name: labels.categories.createSubmit, exact: true })
          .click();
        await expect(createDialog).toHaveCount(0);
        await create(b);
        await all();
        await expect(cards).toHaveCount(3);
        await actions();
        await expect(menu.getByRole("menuitem")).toHaveCount(3);
        await page.screenshot({ path: `test-results/categories/${language}-menu.png` });
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(page.locator('[data-ui="pdf-scroll"]')).toHaveCount(0);
        await move(a);
        await expect(cards).toHaveCount(3); // All papers still includes classified papers.
        await uncategorized();
        await expect(cards).toHaveCount(2);
        await selectCategory(a);
        await expect(cards).toHaveCount(1);
        await actions();
        await menu.getByRole("menuitem", { name: labels.common.star, exact: true }).click();
        await favorites();
        await expect(cards).toHaveCount(2);
        await selectCategory(a);
        await expect(cards).toHaveCount(1); // Starring preserves membership.
        await move(b);
        await expect(cards).toHaveCount(0);
        await selectCategory(b);
        await expect(cards).toHaveCount(1);
        await page.reload();
        await expect(cards).toHaveCount(3);
        await selectCategory(b);
        await expect(cards).toHaveCount(1);
        await primary.click();
        await expect(page.locator('[data-ui="pdf-page"][data-page="2"]')).toHaveAttribute(
          "data-rendered",
          "true",
          { timeout: 30_000 },
        );
        await page.getByRole("button", { name: labels.common.library, exact: true }).click();
        await expect(page.locator('[data-ui="pdf-scroll"]')).toHaveCount(0);

        // Removing the category rehomes its paper, without deleting PDF/chat/cache.
        await categoryRow(b).hover();
        await categoryRow(b).locator('[data-ui="category-actions"]').click();
        page.once("dialog", (dialog) => dialog.accept());
        await menu.getByRole("menuitem", { name: labels.categories.remove, exact: true }).click();
        await expect(categoryRow(b)).toHaveCount(0);
        await expect(cards).toHaveCount(3);
        await expect(page.locator('[data-ui="uncategorized-category"]')).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        await favorites();
        await expect(cards).toHaveCount(2);
        await all();
        await expect(cards).toHaveCount(3);
        const preserved = await page.evaluate(async (id) => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const r = indexedDB.open("cachalot-pdfs", 1);
            r.onsuccess = () => resolve(r.result);
          });
          const size = await new Promise<number>((resolve) => {
            const r = db.transaction("pdfs").objectStore("pdfs").get(id);
            r.onsuccess = () => resolve(r.result.byteLength);
          });
          db.close();
          const cache = await new Promise<IDBDatabase>((resolve) => {
            const request = indexedDB.open("cachalot-analysis", 1);
            request.onsuccess = () => resolve(request.result);
          });
          const cachedPages = await new Promise<Array<{ page: number; observedAt: number }>>(
            (resolve) => {
              const request = cache
                .transaction("pages")
                .objectStore("pages")
                .index("documentId")
                .getAll(id);
              request.onsuccess = () =>
                resolve(
                  request.result
                    .filter((entry: LayoutObservations) => entry.kind === "layout-observations")
                    .map((entry: LayoutObservations) => ({
                      page: entry.page,
                      observedAt: entry.observedAt,
                    })),
                );
            },
          );
          cache.close();
          return {
            size,
            cachedPages,
            threads: JSON.parse(localStorage.getItem("cachalot:threads") || "[]"),
            state: JSON.parse(localStorage.getItem("cachalot:categories") || "{}"),
            docs: JSON.parse(localStorage.getItem("cachalot:documents") || "[]"),
          };
        }, ids[0]);
        assert.equal(preserved.size, bytes.length);
        assert.deepEqual(
          preserved.cachedPages,
          observations.map(({ page, observedAt }) => ({ page, observedAt })),
        );
        assert.equal(preserved.threads[0].title, "Existing discussion");
        assert.equal(preserved.state.assignments[ids[0]], undefined);
        assert.equal(
          preserved.docs.find((doc: { id: string }) => doc.id === ids[0]).currentPage,
          2,
        );
        assert.equal(preserved.docs.find((doc: { id: string }) => doc.id === ids[0]).starred, true);
        await page.screenshot({ path: `test-results/categories/${language}-library.png` });

        // Returning explicitly to Uncategorized and deleting a paper use the same menu.
        await move(a);
        await move(labels.nav.papers);
        await expect(cards).toHaveCount(3);
        const third = cards.filter({
          has: page.getByRole("heading", { name: "Reference 3", exact: true }),
        });
        await third.hover();
        await third.locator('[data-ui="document-actions"]').click();
        page.once("dialog", (dialog) => dialog.accept());
        await menu.getByRole("menuitem", { name: labels.common.delete, exact: true }).click();
        await expect(cards).toHaveCount(2);
        await page.reload();
        await expect(cards).toHaveCount(2);
        await expect(categoryRow(a)).toBeVisible();
        await expect(categoryRow(b)).toHaveCount(0);
        assert.deepEqual(errors, []);
        console.log(
          `${language}: categories, favorites, all-papers, move/reload, reader reopening and safe category deletion passed`,
        );
      } catch (cause) {
        await pageSnapshot(context, language);
        throw cause;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  async function pageSnapshot(
    context: import("@playwright/test").BrowserContext,
    language: string,
  ) {
    const page = context.pages()[0];
    if (page) {
      await page.screenshot({ path: `test-results/categories/${language}-failure.png` });
      console.error(await page.locator("body").innerText());
    }
  }
});
