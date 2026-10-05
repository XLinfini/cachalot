/** Sorting works in an isolated library; no PDFs or model services are needed. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import { zh } from "../fixtures/locales";
import { en } from "../fixtures/locales";

test("Library sorting", async () => {
  await mkdir("test-results/library-sort", { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
  try {
    for (const language of ["zh", "en"] as const) {
      const labels = language === "zh" ? zh : en;
      const context = await browser.newContext({ viewport: { width: 1194, height: 834 } });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (entry) => {
          if (entry.type() === "error") errors.push(entry.text());
        });
        await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
        await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
        await page.evaluate(async (language) => {
          const now = Math.floor(Date.now() / 1000);
          const documents = [
            { id: "ten", title: "Paper 10", createdAt: now - 40, updatedAt: now },
            { id: "two", title: "Paper 2", createdAt: now - 10, updatedAt: now - 300 },
            { id: "alpha", title: "Alpha", createdAt: now - 20, updatedAt: now - 200 },
            { id: "beta", title: "Beta", createdAt: now, updatedAt: now - 100 },
          ].map((document) => ({
            ...document,
            fileName: `${document.id}.pdf`,
            pageCount: 1,
            currentPage: 1,
            starred: ["alpha", "beta"].includes(document.id),
          }));
          localStorage.setItem("cachalot:documents", JSON.stringify(documents));
          localStorage.setItem(
            "cachalot:categories",
            JSON.stringify({
              categories: [{ id: "fixture-category", name: "Fixture category", createdAt: now }],
              assignments: { ten: "fixture-category", two: "fixture-category" },
            }),
          );
          localStorage.setItem("cachalot:setting:uiLanguage", language);
          // Cached synthetic covers isolate the menu from PDF rendering.
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open("cachalot-previews", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("previews");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          const canvas = window.document.createElement("canvas");
          canvas.width = 160;
          canvas.height = 210;
          const draw = canvas.getContext("2d")!;
          const images = documents.map((document) => {
            draw.fillStyle = "#fff";
            draw.fillRect(0, 0, 160, 210);
            draw.fillStyle = "#172b45";
            draw.font = "bold 14px sans-serif";
            draw.fillText(document.title, 16, 30);
            draw.fillStyle = "#b8c5d8";
            for (let line = 0; line < 9; line++)
              draw.fillRect(16, 55 + line * 12, line % 3 === 2 ? 80 : 128, 2);
            return { id: document.id, image: canvas.toDataURL() };
          });
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("previews", "readwrite");
            for (const cover of images)
              tx.objectStore("previews").put(cover.image, `preview:v1:${cover.id}`);
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
          db.close();
        }, language);
        await page.reload();
        const titles = page.locator('[data-ui="document-card"] h3');
        const button = page.getByRole("button", { name: labels.library.sort, exact: true });
        const menu = page.locator('[data-menu-kind="sort"]');
        const choose = async (label: string) => {
          await button.click();
          await menu.getByRole("menuitemradio", { name: label, exact: true }).click();
          await expect(menu).toHaveCount(0);
        };
        await expect(titles).toHaveText(["Beta", "Paper 2", "Alpha", "Paper 10"]);
        await choose(labels.library.sortNameAsc);
        await expect(titles).toHaveText(["Alpha", "Beta", "Paper 2", "Paper 10"]);
        await choose(labels.library.sortNameDesc);
        await expect(titles).toHaveText(["Paper 10", "Paper 2", "Beta", "Alpha"]);
        await choose(labels.library.sortImportedAsc);
        await expect(titles).toHaveText(["Paper 10", "Alpha", "Paper 2", "Beta"]);
        await choose(labels.library.sortImportedDesc);
        await expect(titles).toHaveText(["Beta", "Paper 2", "Alpha", "Paper 10"]);
        await choose(labels.library.sortNameAsc);
        await button.click();
        await expect(
          menu.getByRole("menuitemradio", { name: labels.library.sortNameAsc, exact: true }),
        ).toHaveAttribute("aria-checked", "true");
        await page.screenshot({ path: `test-results/library-sort/${language}-menu.png` });
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
        await expect(button).toBeFocused();
        await page.reload();
        await expect(titles).toHaveText(["Alpha", "Beta", "Paper 2", "Paper 10"]);
        await page.locator('[data-ui="favorites-category"]').click();
        await expect(titles).toHaveText(["Alpha", "Beta"]);
        await choose(labels.library.sortNameDesc);
        await expect(titles).toHaveText(["Beta", "Alpha"]);
        await page
          .locator('[data-ui="category-row"]')
          .getByRole("button", { name: "Fixture category", exact: true })
          .click();
        await expect(titles).toHaveText(["Paper 10", "Paper 2"]);
        await choose(labels.library.sortNameAsc);
        await expect(titles).toHaveText(["Paper 2", "Paper 10"]);
        await page
          .locator('[data-ui="app-nav"]')
          .getByRole("button", { name: labels.nav.all, exact: true })
          .click();
        await page.getByPlaceholder(labels.library.search, { exact: true }).fill("Paper");
        await expect(titles).toHaveText(["Paper 2", "Paper 10"]);
        await choose(labels.library.sortImportedAsc);
        await expect(titles).toHaveText(["Paper 10", "Paper 2"]);
        assert.equal(
          await page.evaluate(() => localStorage.getItem("cachalot:setting:librarySort")),
          "imported-asc",
        );
        assert.deepEqual(errors, []);
        console.log(
          `${language}: four sort orders, selection, keyboard dismissal, refresh, categories and search passed`,
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});
