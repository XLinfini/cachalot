/** Integration checks use an isolated browser profile, never the user's library. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, test, type Page } from "@playwright/test";
import type { PageAnalysis } from "../../src/domain/analysis";

test("Live paper analysis @paper", async () => {
  const paper = process.env.CACHALOT_PAPER;
  if (!paper) {
    test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
    return;
  }
  const browser = await chromium.launch({
    executablePath: process.env.CACHALOT_CHROMIUM,
    headless: true,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  const modelRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    // Vite's ?import&url module contains only a filename, not the WASM binary.
    if (
      !url.searchParams.has("import") &&
      /docling-heron\.onnx|pdfium.*\.wasm$|ort-wasm.*\.wasm$/.test(url.pathname)
    )
      modelRequests.push(request.url());
  });
  const waitReady = async (page: Page) => {
    await page.waitForFunction(
      () => {
        const strip = document.querySelector('[data-ui="analysis-strip"]');
        return (
          strip?.textContent?.includes("版面分析已保存") ||
          strip?.getAttribute("data-phase") === "error"
        );
      },
      undefined,
      { timeout: 180_000 },
    );
    assert.match(await page.locator('[data-ui="analysis-strip"]').innerText(), /版面分析已保存/);
    await page.locator('[data-ui="pdf-page"][data-page="1"] > canvas').waitFor();
  };
  const readCache = () =>
    page.evaluate(async (): Promise<PageAnalysis[]> => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("cachalot-analysis", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const result = await new Promise<PageAnalysis[]>((resolve, reject) => {
        const r = db.transaction("pages").objectStore("pages").getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      db.close();
      return result;
    });
  try {
    await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
    if (process.env.CACHALOT_CHECK_RETRY === "1")
      await page.route("**/models/docling-heron.onnx", (route) =>
        route.fulfill({ status: 404, body: "missing model" }),
      );
    await page.locator('input[type="file"]').setInputFiles(paper);
    if (process.env.CACHALOT_CHECK_RETRY === "1") {
      await page
        .locator('[data-ui="analysis-strip"][data-phase="error"]')
        .waitFor({ timeout: 30_000 });
      await page.unroute("**/models/docling-heron.onnx");
      await page.getByRole("button", { name: "重试分析" }).click();
    }
    await waitReady(page);
    const first = (await readCache()).filter((p) => !p.cacheKey.includes("native"));
    assert.equal(first.length, 7, "all reference pages are committed");
    assert.ok(first.find((p) => p.page === 1)?.blocks.some((b) => b.kind === "figure"));
    assert.ok(first.find((p) => p.page === 7)?.blocks.some((b) => b.kind === "table"));
    assert.ok(modelRequests.some((url) => url.includes("docling-heron.onnx")));
    await page.getByRole("button", { name: "版面", exact: true }).click();
    await page.locator('[data-ui="layout-box"]').first().waitFor();
    await mkdir("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/reader-layout.png", fullPage: true });

    // Actual pointer drag over only the left half of a paragraph. The popup
    // displays exactly the application DTO's text, so no private test hook exists.
    const native = first.find((p) => p.page === 1)!;
    const body = native.blocks.find(
      (b) => b.kind === "paragraph" && b.characterIndices.length > 200,
    )!;
    const bounds = await page.locator('[data-ui="pdf-page"][data-page="1"]').boundingBox();
    assert.ok(bounds);
    const right = (body.box[0] + body.box[2]) / 2;
    await page.mouse.move(
      bounds.x + body.box[0] * bounds.width,
      bounds.y + body.box[1] * bounds.height,
    );
    await page.mouse.down();
    await page.mouse.move(bounds.x + right * bounds.width, bounds.y + body.box[3] * bounds.height, {
      steps: 8,
    });
    await page.mouse.up();
    await page.getByRole("button", { name: "翻译选区" }).click();
    await page.locator('[data-ui="translation-source-format"]').click();
    const selected = await page.locator('[data-ui="translation-source-text"]').innerText();
    assert.ok(
      selected.length > 0 && selected.length < body.text.length,
      "partial rectangle must not expand to the full paragraph",
    );
    await page.getByRole("button", { name: "关闭翻译" }).click();

    const before = modelRequests.length;
    await page.reload();
    await page.locator('[data-ui="document-card"]').first().click();
    await waitReady(page);
    assert.equal(modelRequests.length, before, "cached reopen must not load model or PDFium");
    const reopened = (await readCache()).filter((p) => !p.cacheKey.includes("native"));
    assert.deepEqual(
      reopened.map((p) => p.analyzedAt),
      first.map((p) => p.analyzedAt),
    );

    // Simulate exiting before the final page completed: retain native page and
    // all other full analyses. Reopening should replace only the missing page.
    const missing = first.find((p) => p.page === 7)!;
    await page.evaluate(async (entry) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("cachalot-analysis", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pages", "readwrite");
        tx.objectStore("pages").delete([entry.documentId, entry.cacheKey, entry.page]);
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      db.close();
    }, missing);
    await page.reload();
    await page.locator('[data-ui="document-card"]').first().click();
    await waitReady(page);
    const resumed = (await readCache()).filter((p) => !p.cacheKey.includes("native"));
    for (const cached of first.filter((p) => p.page !== 7))
      assert.equal(resumed.find((p) => p.page === cached.page)?.analyzedAt, cached.analyzedAt);
    assert.ok(resumed.find((p) => p.page === 7)!.analyzedAt > missing.analyzedAt);
    assert.deepEqual(errors, [], "browser and worker should finish without uncaught errors");
    const summary = {
      pages: first.length,
      cacheBytes: JSON.stringify(await readCache()).length,
      partialTextLength: selected.length,
      cachedReopenLoadedModel: false,
      resumedPages: [7],
      missingModelRetry: process.env.CACHALOT_CHECK_RETRY === "1",
      errors,
    };
    await writeFile("test-results/browser-verification.json", JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } catch (error) {
    await mkdir("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/browser-failure.png", fullPage: true });
    console.error(
      JSON.stringify({ errors, modelRequests, body: await page.locator("body").innerText() }),
    );
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
});
