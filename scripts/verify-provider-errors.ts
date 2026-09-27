/** Real UI checks with local 503 fixtures; never contact a configured provider. */
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { ANALYSIS_CACHE_KEY } from "../src/domain/model";
import type { PageAnalysis } from "../src/domain/analysis";
import { en } from "../src/i18n/locales/en";
import { zh } from "../src/i18n/locales/zh";

const paper = process.argv[2];
if (!paper)
  throw new Error("Usage: npm run test:provider-error-ui -- /absolute/path/reference.pdf");
const analyses: PageAnalysis[] = JSON.parse(
  await readFile("test-results/paper-analysis.json", "utf8"),
);
const bytes = Array.from(await readFile(paper));
const fakeKey = "sk-fixture-only-never-real-abcd";
const reason = "Upstream unavailable: local diagnostic fixture";
const body = JSON.stringify({
  error: { message: reason, detail: "x".repeat(500) + "end of diagnostic", api_key: fakeKey },
});
await mkdir("test-results/provider-errors", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
try {
  for (const language of ["zh", "en"] as const) {
    const labels = language === "zh" ? zh : en;
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 } });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let completionRequests = 0;
      await page.route("**/v1/**", (route) => {
        if (route.request().url().endsWith("/chat/completions")) completionRequests++;
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          headers: { "x-request-id": "fixture-request-503" },
          body,
        });
      });
      await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
      await page.evaluate(
        async ({ analyses, bytes, language, key }) => {
          const id = analyses[0].documentId;
          const now = Math.floor(Date.now() / 1000);
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
          localStorage.setItem(
            "cachalot:providers",
            JSON.stringify([
              {
                id: "error-fixture",
                name: "Local fixture",
                baseUrl: `${location.origin}/v1`,
                modelId: "fixture-model",
                enabled: true,
                hasKey: false,
              },
            ]),
          );
          localStorage.setItem("cachalot:setting:activeProviderId", "error-fixture");
          localStorage.setItem("cachalot:setting:uiLanguage", language);
          const pdf = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("cachalot-pdfs", 1);
            request.onupgradeneeded = () => request.result.createObjectStore("pdfs");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = pdf.transaction("pdfs", "readwrite");
            tx.objectStore("pdfs").put(new Uint8Array(bytes).buffer, id);
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
          pdf.close();
          const cache = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open("cachalot-analysis", 1);
            request.onupgradeneeded = () =>
              request.result
                .createObjectStore("pages", { keyPath: ["documentId", "cacheKey", "page"] })
                .createIndex("documentId", "documentId");
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = cache.transaction("pages", "readwrite");
            for (const entry of analyses) tx.objectStore("pages").put({ ...entry, cacheKey: key });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
          cache.close();
        },
        { analyses, bytes, language, key: ANALYSIS_CACHE_KEY },
      );
      await page.reload();
      await page.getByRole("button", { name: labels.common.settings, exact: true }).first().click();
      await page.locator('[data-ui="api-key-input"]').fill(fakeKey);
      await page.getByRole("button", { name: labels.common.save, exact: true }).click();
      await expect(page.locator('[data-ui="api-key-input"]')).toHaveValue("sk-...abcd");
      await page.getByRole("button", { name: labels.settings.testConnection, exact: true }).click();
      const notice = page.getByText(reason, { exact: false });
      await expect(notice).toContainText("HTTP 503");
      await expect(notice).toContainText("fixture-request-503");
      await expect(notice).toContainText("end of diagnostic");
      assert.ok(!(await notice.innerText()).includes(fakeKey));

      await page.getByRole("button", { name: labels.common.backLibrary, exact: true }).click();
      await page.locator('[data-ui="document-card"]').first().click();
      await page.locator('[data-ui="analysis-strip"][data-phase="ready"]').waitFor();
      const leaf = page.locator('[data-ui="pdf-page"][data-page="1"]');
      await expect(leaf).toHaveAttribute("data-rendered", "true");
      const geometry = await leaf.boundingBox();
      assert.ok(geometry);
      const paragraph = analyses[0].blocks.find(
        (block) => block.kind === "paragraph" && block.characterIndices.length > 200,
      )!;
      await page.mouse.move(
        geometry.x + paragraph.box[0] * geometry.width,
        geometry.y + paragraph.box[1] * geometry.height,
      );
      await page.mouse.down();
      await page.mouse.move(
        geometry.x + ((paragraph.box[0] + paragraph.box[2]) / 2) * geometry.width,
        geometry.y + paragraph.box[3] * geometry.height,
        { steps: 6 },
      );
      await page.mouse.up();
      await page.screenshot({ path: `test-results/provider-errors/selection-${language}.png` });
      await page.getByRole("button", { name: labels.reader.translate }).click();
      const error = page.locator('[data-ui="translation-error"]');
      await expect(error).toContainText("HTTP 503");
      await expect(error).toContainText(reason);
      await expect(error).toContainText("end of diagnostic");
      await expect(error).toContainText("fixture-request-503");
      assert.ok(!(await error.innerText()).includes(fakeKey));
      assert.equal(await error.evaluate((node) => getComputedStyle(node).whiteSpace), "pre-wrap");
      await expect(
        page.getByRole("button", { name: labels.translation.copy, exact: true }),
      ).toBeDisabled();
      assert.equal(completionRequests, 1, "A failed translation must not retry automatically");
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `test-results/provider-errors/${language}.png` });
    } finally {
      await context.close();
    }
  }
  console.log(
    "Provider error UI checks passed: settings and translation show status, full diagnostic, request ID and redacted credentials in zh/en.",
  );
} finally {
  await browser.close();
}
