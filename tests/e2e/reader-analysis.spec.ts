/** Integration checks use an isolated browser profile, never the user's library. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, expect, test, type Page } from "@playwright/test";
import type { PageFacts, LayoutObservations } from "../../src/domain/analysis";
import type { DocumentSemantics } from "../../src/domain/document-semantics";
import { projectSemanticPage } from "../../src/application/document-analysis/document-semantics";
import {
  selectRegion,
  selectRegionUnits,
} from "../../src/application/selection-translation/select-region";
interface CacheBundle {
  facts: PageFacts[];
  observations: LayoutObservations[];
  semantics: DocumentSemantics;
}

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
    page.evaluate(async (): Promise<CacheBundle> => {
      async function read(database: string, store: string) {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(database, 1);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          return await new Promise<unknown[]>((resolve, reject) => {
            const request = db.transaction(store).objectStore(store).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } finally {
          db.close();
        }
      }
      const pages = (await read("cachalot-analysis", "pages")) as Array<
        PageFacts | LayoutObservations
      >;
      const documents = (await read("cachalot-semantics", "documents")) as DocumentSemantics[];
      return {
        facts: pages.filter((page): page is PageFacts => page.kind === "page-facts"),
        observations: pages.filter(
          (page): page is LayoutObservations => page.kind === "layout-observations",
        ),
        semantics: documents[0],
      };
    });
  try {
    await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
    if (process.env.CACHALOT_CHECK_RETRY === "1")
      await page.route("**/models/docling-heron.onnx", (route) =>
        route.fulfill({ status: 404, body: "missing model" }),
      );
    await page.locator('input[type="file"]').setInputFiles(paper);
    // Import normally opens the reader. If initialization leaves the document
    // in the library, open the saved card explicitly instead of waiting forever.
    const reader = page.locator('[data-ui="pdf-scroll"]');
    try {
      await reader.waitFor({ timeout: 10_000 });
    } catch {
      await page.locator('[data-ui="document-card"]').first().click({ timeout: 10_000 });
      await reader.waitFor({ timeout: 10_000 });
    }
    if (process.env.CACHALOT_CHECK_RETRY === "1") {
      await page
        .locator('[data-ui="analysis-strip"][data-phase="error"]')
        .waitFor({ timeout: 30_000 });
      await page.unroute("**/models/docling-heron.onnx");
      await page.getByRole("button", { name: "重试分析" }).click();
    }
    await waitReady(page);
    const initial = await readCache();
    const first = initial.observations;
    const views = initial.facts.map((facts) => projectSemanticPage(initial.semantics, facts));
    assert.equal(first.length, 7, "all reference pages are committed");
    assert.ok(views.find((p) => p.page === 1)?.blocks.some((b) => b.kind === "figure"));
    assert.ok(views.find((p) => p.page === 7)?.blocks.some((b) => b.kind === "table"));
    assert.ok(modelRequests.some((url) => url.includes("docling-heron.onnx")));
    await page.getByRole("button", { name: "版面", exact: true }).click();
    await page.locator('[data-ui="layout-box"]').first().waitFor();
    await mkdir("test-results", { recursive: true });
    await page.screenshot({ path: "test-results/reader-layout.png", fullPage: true });

    // A partly enclosed paragraph cannot be translated; full containment uses
    // exactly the application DTO's source and its visual unit boundary.
    const native = views.find((p) => p.page === 1)!;
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
    await expect(page.locator('[data-ui="selected-unit"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "翻译选区" })).toHaveCount(0);
    const unit = selectRegionUnits(native, [0, 0, 1, 1]).find((unit) => unit.id === body.id)!;
    const fullBox: [number, number, number, number] = [
      unit.box[0] - 0.003,
      unit.box[1] - 0.003,
      unit.box[2] + 0.003,
      unit.box[3] + 0.003,
    ];
    await page.mouse.move(
      bounds.x + fullBox[0] * bounds.width,
      bounds.y + fullBox[1] * bounds.height,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + fullBox[2] * bounds.width,
      bounds.y + fullBox[3] * bounds.height,
      { steps: 8 },
    );
    await page.mouse.up();
    await expect(
      page.locator(`[data-ui="selected-unit"][data-unit-id="${body.id}"]`),
    ).toBeVisible();
    await page.getByRole("button", { name: "翻译选区" }).click();
    await page.locator('[data-ui="translation-source-format"]').click();
    const selected = await page.locator('[data-ui="translation-source-text"]').innerText();
    assert.equal(selected, selectRegion(native, fullBox).text);
    await page.getByRole("button", { name: "关闭翻译" }).click();

    const before = modelRequests.length;
    await page.reload();
    await page.locator('[data-ui="document-card"]').first().click();
    await waitReady(page);
    assert.equal(modelRequests.length, before, "cached reopen must not load model or PDFium");
    const reopened = (await readCache()).observations;
    assert.deepEqual(
      reopened.map((p) => p.observedAt),
      first.map((p) => p.observedAt),
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
    const resumed = (await readCache()).observations;
    for (const cached of first.filter((p) => p.page !== 7))
      assert.equal(resumed.find((p) => p.page === cached.page)?.observedAt, cached.observedAt);
    assert.ok(resumed.find((p) => p.page === 7)!.observedAt > missing.observedAt);
    assert.deepEqual(errors, [], "browser and worker should finish without uncaught errors");
    const summary = {
      pages: first.length,
      cacheBytes: JSON.stringify(await readCache()).length,
      completeTextLength: selected.length,
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
