/** Real paper, pointer selection and IndexedDB; every provider response is a
 * local fixture. This verifies wiring and failure behavior, not model accuracy. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import { TRANSCRIPTION_VERSION } from "../../src/application/formula-transcription";
import { zh } from "../../src/i18n/locales/zh";
import { en } from "../../src/i18n/locales/en";
import { fixtureTranslation } from "../fixtures/translation";
import { verifyHeadings } from "./scenarios/headings";
import { loadReferencePaper } from "../support/reference-paper";
import { seedPaper } from "../support/seed-paper";

for (const language of ["zh", "en"] as const) {
  test(`Formula transcription and OCR (${language}) @paper`, async () => {
    const paper = process.env.CACHALOT_PAPER;
    if (!paper) {
      test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
      return;
    }
    const { analyses, bytes } = await loadReferencePaper(paper);
    const correct = "C\\approx\\frac{0.2\\cdot I_{op}}{2\\pi\\cdot f_o\\cdot V_{op}}";
    const switchingFormulas = {
      "p2-display-3766-3831":
        "f_s=\\frac{\\frac{\\alpha^2}{4}-(\\sin\\omega t-\\frac{\\alpha}{2})^2}{\\alpha\\cdot C\\cdot V_b}\\cdot I_{op}.",
      "p2-display-3990-4051":
        "f_{s\\_\\mathrm{max}}=\\frac{\\alpha\\cdot I_{op}}{4C\\cdot V_b}=\\frac{I_L}{4C\\cdot V_b}.",
    } as const;
    const deferred = () => {
      let release!: () => void;
      const promise = new Promise<void>((resolve) => {
        release = resolve;
      });
      return { promise, release };
    };
    await mkdir("test-results/formula-transcription", { recursive: true });
    const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
    try {
      const labels = language === "zh" ? zh : en;
      const context = await browser.newContext({ viewport: { width: 1194, height: 834 } });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await context.route("https://**/*", (route) => route.abort());
      let mode: "valid" | "mixed" | "wrong" | "null" | "malformed" | "network" = "valid";
      let gate = { recognition: deferred(), translation: deferred() };
      gate.recognition.release();
      gate.translation.release();
      const requests: any[] = [];
      const glmRequests: any[] = [];
      let glmMode: "valid" | "network" | "wrong" = "valid";
      const fixtureKey = "ocr-fixture-private-1234";
      await page.route("**/api/paas/v4/layout_parsing", async (route) => {
        const input = route.request().postDataJSON();
        glmRequests.push(input);
        assert.ok(input.file.startsWith("data:image/png;base64,"));
        assert.equal(input.messages, undefined, "Dedicated OCR receives a crop, not a chat prompt");
        assert.equal(route.request().headers().authorization, `Bearer ${fixtureKey}`);
        if (glmMode === "network") {
          await route.fulfill({
            status: 503,
            headers: { "x-request-id": "glm-fixture-503" },
            json: { error: { message: `local OCR diagnostic ${fixtureKey}` } },
          });
          return;
        }
        const id = await page.evaluate(async (image) => {
          const db = await new Promise<IDBDatabase>((resolve) => {
            const r = indexedDB.open("cachalot-formulas", 1);
            r.onsuccess = () => resolve(r.result);
          });
          const records = await new Promise<any[]>((resolve) => {
            const tx = db.transaction("assets", "readonly"),
              r = tx.objectStore("assets").getAll();
            r.onsuccess = () => resolve(r.result);
          });
          db.close();
          return records.find((r) => r.asset.imageDataUrl === image)?.id;
        }, input.file);
        const latex = id
          ? switchingFormulas[id as keyof typeof switchingFormulas] || correct
          : "x^2+1=0";
        await route.fulfill({
          json: {
            model: input.model,
            md_results: `$$${latex}$$`,
            layout_details: [
              [
                {
                  label: "formula",
                  content: `$$${glmMode === "wrong" ? latex.replaceAll("I_{op}", "I_{0p}") : latex}$$`,
                },
              ],
            ],
          },
        });
      });
      const ocr = () => requests.filter((r) => String(r.messages[0].content).startsWith("仅转写"));
      await page.route("**/v1/chat/completions", async (route) => {
        const input = route.request().postDataJSON();
        requests.push(input);
        const recognition = String(input.messages[0].content).startsWith("仅转写");
        const content = input.messages.at(-1).content;
        let answer: string;
        if (recognition) {
          await gate.recognition.promise;
          if (mode === "network") {
            await route.fulfill({
              status: 503,
              headers: { "x-request-id": "formula-fixture-503" },
              contentType: "application/json",
              body: JSON.stringify({ error: { message: "local formula diagnostic" } }),
            });
            return;
          }
          answer =
            mode === "malformed"
              ? "invalid JSON"
              : JSON.stringify(
                  content
                    .filter((part: any) => part.type === "text")
                    .map((part: any) => {
                      const id = JSON.parse(part.text).id;
                      const latex =
                        switchingFormulas[id as keyof typeof switchingFormulas] || correct;
                      return {
                        id,
                        latex:
                          mode === "null" || (mode === "mixed" && id === "p2-display-3990-4051")
                            ? null
                            : mode === "wrong"
                              ? latex.replace("I_{op}", "I_{0p}")
                              : latex,
                      };
                    }),
                );
        } else {
          await gate.translation.promise;
          const text =
            typeof content === "string"
              ? content
              : content.find((p: any) => p.type === "text").text;
          answer = fixtureTranslation(text);
        }
        await route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`,
        });
      });
      try {
        await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
        await page.evaluate(
          async ({ id, language }) => {
            const now = Math.floor(Date.now() / 1000);
            localStorage.setItem(
              "cachalot:documents",
              JSON.stringify([
                {
                  id,
                  title: "Reference paper",
                  fileName: "reference.pdf",
                  pageCount: 7,
                  currentPage: 2,
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
                  id: "formula-fixture",
                  name: "Local formula fixture",
                  baseUrl: `${location.origin}/v1`,
                  modelId: "fixture-text",
                  enabled: true,
                  hasKey: false,
                },
              ]),
            );
            localStorage.setItem("cachalot:setting:activeProviderId", "formula-fixture");
            localStorage.setItem(
              "cachalot:setting:addedModels:formula-fixture",
              JSON.stringify([{ id: "fixture-text" }, { id: "fixture-vision" }]),
            );
            localStorage.setItem(
              "cachalot:setting:vision:model:formula-fixture:fixture-vision",
              "true",
            );
            localStorage.setItem("cachalot:setting:uiLanguage", language);
          },
          { id: analyses[0].documentId, language },
        );
        await seedPaper(page, { analyses, bytes });
        await page.reload();
        await page.locator('[data-ui="document-card"]').first().click();
        await page.locator('[data-ui="analysis-strip"][data-phase="ready"]').waitFor();
        const host = page.locator('[data-ui="pdf-page"][data-page="2"][data-rendered="true"]');
        await host.waitFor();
        await page.getByTitle(labels.reader.page.replace("{{page}}", "2"), { exact: true }).click();
        await page.waitForFunction(() => {
          const top = document
            .querySelector('[data-ui="pdf-page"][data-page="2"]')
            ?.getBoundingClientRect().top;
          return top !== undefined && top > 100 && top < 250;
        });
        const bounds = (await host.boundingBox())!;
        await page.mouse.move(bounds.x + 0.509 * bounds.width, bounds.y + 0.25 * bounds.height);
        await page.mouse.down();
        await page.mouse.move(bounds.x + 0.936 * bounds.width, bounds.y + 0.373 * bounds.height, {
          steps: 6,
        });
        await page.mouse.up();
        const copy = page.getByRole("button", { name: labels.translation.copy, exact: true });
        const open = async () => {
          await page.getByRole("button", { name: labels.reader.translate }).click();
          await expect(copy).toBeEnabled();
        };
        const choose = async (model: string) => {
          await page.getByRole("button", { name: labels.chat.chooseModel, exact: true }).click();
          const menu = page.locator('[data-ui="model-menu"]');
          const group = menu.getByRole("button", { name: "Local formula fixture", exact: true });
          if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
          await menu.getByRole("button", { name: model, exact: true }).click();
        };
        const mutateCache = async (legacy: boolean) =>
          page.evaluate(
            async ({ legacy, version }) => {
              const db = await new Promise<IDBDatabase>((resolve) => {
                const r = indexedDB.open("cachalot-formulas", 1);
                r.onsuccess = () => resolve(r.result);
              });
              await new Promise<void>((resolve, reject) => {
                const tx = db.transaction("assets", "readwrite"),
                  store = tx.objectStore("assets"),
                  r = store.getAll();
                r.onsuccess = () => {
                  for (const record of r.result) {
                    for (const key of Object.keys(record.candidates))
                      if (key.startsWith(version)) delete record.candidates[key];
                    if (legacy) {
                      delete record.asset.formula.characters;
                      if (record.asset.formula.mode === "display")
                        record.candidates["transcribe-v1:formula-fixture:fixture-vision"] = "WRONG";
                    }
                    store.put(record);
                  }
                };
                tx.oncomplete = () => resolve();
                tx.onabort = () => reject(tx.error);
              });
              db.close();
            },
            { legacy, version: TRANSCRIPTION_VERSION },
          );
        await open();
        assert.equal(ocr().length, 0, "text model never sends an OCR image");
        const sourceBytes = await page
          .locator('[data-ui="translation-result"] [data-ui="preserved-formula"]')
          .evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).src));
        const partialBytes = await page
          .locator(
            '[data-ui="translation-result"] [data-ui="preserved-formula"][data-mode="inline"]',
          )
          .evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).src));
        await page.getByRole("button", { name: labels.translation.close }).click();
        await mutateCache(true);
        await choose("fixture-vision");
        gate = { recognition: deferred(), translation: deferred() };
        await page.getByRole("button", { name: labels.reader.translate }).click();
        await expect.poll(() => ocr().length).toBe(1);
        await expect(page.locator('[data-ui="translation-progress"]')).toHaveAttribute(
          "data-phase",
          "preparing",
        );
        assert.equal(ocr()[0].model, "fixture-vision");
        const evidence = JSON.parse(ocr()[0].messages[1].content[0].text);
        assert.equal(evidence.id, analyses[1].formulas!.find((f) => f.mode === "display")!.id);
        for (const symbol of ["0", "o", "π", "C"])
          assert.ok(evidence.glyphs.some((c: any) => c.text === symbol));
        assert.ok(
          evidence.glyphs.every(
            (c: any) => c.box.length === 4 && c.origin.length === 2 && c.emSize > 1,
          ),
        );
        assert.equal(
          evidence.glyphs
            .filter((c: any) => c.role === "equation-label")
            .map((c: any) => c.text)
            .join(""),
          "(1)",
        );
        assert.ok(ocr()[0].messages[1].content[1].image_url.url.startsWith("data:image/png;"));
        gate.recognition.release();
        await expect(page.locator('[data-ui="translation-progress"]')).toHaveAttribute(
          "data-phase",
          "translating",
        );
        const raw = page.locator('[data-ui="translation-source-text"]');
        const result = page.locator('[data-ui="translation-result"]');
        const resultImages = result.locator('[data-ui="preserved-formula"]');
        const checkSingleEquation = async () => {
          await expect(result.locator(".katex-display annotation")).toHaveText(correct);
          assert.deepEqual(
            await resultImages.evaluateAll((nodes) =>
              nodes.map((n) => (n as HTMLImageElement).src),
            ),
            partialBytes,
            "only the partially selected inline formula retains its original crop",
          );
        };
        await expect(
          page.locator('[data-ui="translation-reconstructed-source"] .katex-display'),
        ).toHaveCount(1);
        await expect(copy).toBeDisabled();
        assert.ok(
          JSON.stringify(requests.at(-1)).includes(JSON.stringify(correct).slice(1, -1)),
          "preview and translation glossary use the same candidate",
        );
        await page.screenshot({
          path: `test-results/formula-transcription/prepared-${language}.png`,
        });
        const columns = await Promise.all(
          ["translation-source", "translation-reconstructed-source", "translation-result"].map(
            (name) => page.locator(`[data-ui="${name}"]`).boundingBox(),
          ),
        );
        assert.ok(columns.every((box) => box && box.width > 280));
        assert.ok(columns[0]!.x < columns[1]!.x && columns[1]!.x < columns[2]!.x);
        assert.equal(await page.locator('[data-ui="translation-source"] details').count(), 0);
        await page.locator('[data-ui="translation-source-format"]').click();
        await expect(raw).toContainText(correct);
        gate.translation.release();
        await expect(copy).toBeEnabled();
        await expect(result.locator(".katex-display")).toHaveCount(1);
        await checkSingleEquation();
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        assert.equal(ocr().length, 1, "same model and prompt reuse persistent recognition");
        await checkSingleEquation();
        for (const failed of ["wrong", "null", "malformed", "network"] as const) {
          mode = failed;
          await mutateCache(false);
          const before = ocr().length;
          await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
          await expect(copy).toBeEnabled();
          assert.equal(ocr().length, before + 1, "no automatic recognition retries");
          const warning = page.locator('[data-ui="formula-preparation-warning"]');
          await expect(warning).toBeVisible();
          await expect(raw).not.toContainText(correct);
          await expect(raw).not.toContainText("I_{0p}");
          await expect(result.locator(".katex-display")).toHaveCount(0);
          assert.deepEqual(
            await resultImages.evaluateAll((nodes) =>
              nodes.map((n) => (n as HTMLImageElement).src),
            ),
            sourceBytes,
            "failed reconstruction retains the exact original crop",
          );
          if (failed === "wrong")
            await expect(warning).toContainText(labels.translation.formulaIssue.characters);
          if (failed === "network") {
            await expect(warning).toContainText("HTTP 503");
            await expect(warning).toContainText("local formula diagnostic");
            await expect(warning).toContainText("formula-fixture-503");
          }
        }
        await page.screenshot({
          path: `test-results/formula-transcription/fallback-${language}.png`,
        });
        mode = "valid";
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        await expect(page.locator('[data-ui="formula-preparation-warning"]')).toHaveCount(0);
        const beforeText = ocr().length;
        await page.getByRole("button", { name: labels.translation.close }).click();
        await choose("fixture-text");
        await open();
        assert.equal(ocr().length, beforeText);
        assert.ok(!JSON.stringify(requests.at(-1)).includes('"type":"image_url"'));
        await checkSingleEquation();
        await page.locator('[data-ui="translation-source-format"]').click();
        await expect(raw).toContainText(correct);
        await page.getByRole("button", { name: labels.translation.close }).click();
        const headingOutput = `test-results/formula-transcription/headings-${language}`;
        await mkdir(headingOutput, { recursive: true });
        await verifyHeadings(page, labels, headingOutput);
        // Reproduce the reported two-equation selection. Both columns must use
        // the same candidates; a failure in one equation cannot rasterize both.
        await choose("fixture-vision");
        const scroll = page.locator('[data-ui="pdf-scroll"]');
        await scroll.evaluate((node) => {
          node.scrollTop += 400;
        });
        await expect.poll(async () => (await host.boundingBox())!.y).toBeLessThan(0);
        const selectSwitching = async (right = 0.936) => {
          const box = (await host.boundingBox())!;
          await page.mouse.move(box.x + 0.509 * box.width, box.y + 0.535 * box.height);
          await page.mouse.down();
          await page.mouse.move(box.x + right * box.width, box.y + 0.765 * box.height, {
            steps: 6,
          });
          await page.mouse.up();
          await open();
        };
        const checkBoth = async () => {
          const expected = Object.values(switchingFormulas);
          for (const column of [
            page.locator('[data-ui="translation-reconstructed-source"]'),
            result,
          ]) {
            await expect(column.locator(".katex-display")).toHaveCount(2);
            assert.deepEqual(
              await column.locator(".katex-display annotation").allTextContents(),
              expected,
            );
            await expect(column.locator('[data-ui="preserved-formula"]')).toHaveCount(0);
          }
        };
        await selectSwitching();
        await checkBoth();
        await page.screenshot({
          path: `test-results/formula-transcription/two-equations-${language}.png`,
        });
        const beforeCached = ocr().length;
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        assert.equal(ocr().length, beforeCached);
        await checkBoth();
        await mutateCache(false);
        mode = "mixed";
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        await expect(result.locator(".katex-display annotation")).toHaveText(
          switchingFormulas["p2-display-3766-3831"],
        );
        await expect(resultImages).toHaveCount(1);
        await expect(resultImages).toHaveAttribute("data-formula-id", "p2-display-3990-4051");
        await page.screenshot({
          path: `test-results/formula-transcription/mixed-equations-${language}.png`,
        });
        await page.getByRole("button", { name: labels.translation.close }).click();
        mode = "valid";
        const beforePartial = ocr().length;
        await selectSwitching(0.78);
        await expect(result.locator(".katex-display")).toHaveCount(0);
        await expect(
          result.locator('[data-ui="preserved-formula"][data-mode="display"]'),
        ).toHaveCount(2);
        assert.equal(
          ocr().length,
          beforePartial,
          "partial selections do not use full-formula reconstruction",
        );
        await page.getByRole("button", { name: labels.translation.close }).click();
        // Exercise the new settings and a dedicated OCR service while keeping a
        // text-only translation model. All responses stay local fixtures.
        await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
        await expect(page.locator('[data-ui="add-glm-ocr"]')).toHaveCount(0);
        await page.getByRole("button", { name: labels.ocr.title, exact: true }).click();
        await page.locator('[data-ui="add-glm-ocr"]').click();
        await expect(page.locator('[data-ui="ocr-endpoint"]')).toHaveText(
          "https://open.bigmodel.cn/api/paas/v4/layout_parsing",
        );
        await page
          .getByLabel(labels.settings.apiUrl, { exact: true })
          .fill(`${new URL(page.url()).origin}/api/paas/v4`);
        await page.locator('[data-ui="api-key-input"]').fill(fixtureKey);
        await page.getByRole("button", { name: labels.settings.fetchModels, exact: true }).click();
        await expect(page.locator('[data-ui="available-model"]')).toHaveCount(1);
        await expect(page.locator('[data-ui="available-model"]')).toHaveAttribute(
          "data-model-id",
          "glm-ocr",
        );
        await page.getByRole("button", { name: labels.common.done, exact: true }).click();
        await page
          .getByRole("button", { name: labels.settings.testConnection, exact: true })
          .click();
        await expect(
          page.getByText(labels.messages.connectionSucceeded, { exact: true }),
        ).toBeVisible();
        assert.equal(glmRequests.length, 1);
        await page.getByRole("button", { name: labels.ocr.title, exact: true }).click();
        await page.locator("#ocr-mode").selectOption("separate");
        await page.getByRole("button", { name: labels.ocr.chooseModel, exact: true }).click();
        await page
          .locator('[data-ui="model-menu"]')
          .getByRole("button", { name: "GLM-OCR", exact: true })
          .click();
        await page
          .locator('[data-ui="model-menu"]')
          .getByRole("button", { name: "glm-ocr", exact: true })
          .click();
        await expect(page.locator('[data-ui="selected-ocr-model"]')).toHaveText(
          "GLM-OCR · glm-ocr",
        );
        await page.screenshot({
          path: `test-results/formula-transcription/ocr-settings-${language}.png`,
        });
        const selectedOcr = await page.evaluate(() =>
          JSON.parse(localStorage.getItem("cachalot:setting:formulaOcrModel")!),
        );
        await page.getByRole("button", { name: labels.common.backLibrary, exact: true }).click();
        await choose("fixture-text");
        await page.getByRole("button", { name: labels.chat.chooseModel, exact: true }).click();
        await expect(
          page
            .locator('[data-ui="model-menu"]')
            .getByRole("button", { name: "GLM-OCR", exact: true }),
        ).toHaveCount(0);
        await page.keyboard.press("Escape");
        await host.waitFor();
        await page.getByTitle(labels.reader.page.replace("{{page}}", "2"), { exact: true }).click();
        await page.waitForFunction(() => {
          const y = document
            .querySelector('[data-ui="pdf-page"][data-page="2"]')
            ?.getBoundingClientRect().y;
          return y !== undefined && y > 100 && y < 250;
        });
        await scroll.evaluate((node) => {
          node.scrollTop += 400;
        });
        await expect.poll(async () => (await host.boundingBox())!.y).toBeLessThan(0);
        const legacyRequests = ocr().length;
        await selectSwitching();
        await checkBoth();
        assert.equal(glmRequests.length, 3, "Each of the two formulas is recognized separately");
        assert.equal(
          ocr().length,
          legacyRequests,
          "Explicit OCR selection bypasses the translation model's recognizer",
        );
        assert.equal(requests.at(-1).model, "fixture-text");
        assert.ok(!JSON.stringify(requests.at(-1)).includes('"type":"image_url"'));
        await page.screenshot({
          path: `test-results/formula-transcription/glm-ocr-${language}.png`,
        });
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        assert.equal(glmRequests.length, 3, "Successful GLM results are cached independently");
        await checkBoth();
        // A compatible gateway can expose different served model IDs. A switch
        // must use its own candidates, and switching back must recover the cache.
        await page.evaluate((choice) => {
          const key = `cachalot:setting:addedModels:${choice.providerId}`;
          const models = JSON.parse(localStorage.getItem(key)!);
          localStorage.setItem(
            key,
            JSON.stringify([...models, { id: "glm-ocr-alias", formulaOcr: "glm-layout" }]),
          );
          localStorage.setItem(
            "cachalot:setting:formulaOcrModel",
            JSON.stringify({ ...choice, modelId: "glm-ocr-alias" }),
          );
        }, selectedOcr);
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        assert.equal(glmRequests.length, 5);
        assert.equal(glmRequests.at(-1).model, "glm-ocr-alias");
        await checkBoth();
        await page.evaluate(
          (choice) =>
            localStorage.setItem("cachalot:setting:formulaOcrModel", JSON.stringify(choice)),
          selectedOcr,
        );
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        assert.equal(glmRequests.length, 5, "Switching back reuses the original model cache");
        await checkBoth();
        const clearGlm = () =>
          page.evaluate(async () => {
            const db = await new Promise<IDBDatabase>((resolve) => {
              const r = indexedDB.open("cachalot-formulas", 1);
              r.onsuccess = () => resolve(r.result);
            });
            await new Promise<void>((resolve, reject) => {
              const tx = db.transaction("assets", "readwrite"),
                store = tx.objectStore("assets"),
                r = store.getAll();
              r.onsuccess = () => {
                for (const record of r.result) {
                  for (const key of Object.keys(record.candidates))
                    if (key.startsWith("formula-ocr-v1:")) delete record.candidates[key];
                  store.put(record);
                }
              };
              tx.oncomplete = () => resolve();
              tx.onabort = () => reject(tx.error);
            });
            db.close();
          });
        await clearGlm();
        glmMode = "network";
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        assert.equal(
          glmRequests.length,
          6,
          "One failed request stops remaining OCR crops without retries",
        );
        await expect(resultImages).toHaveCount(2);
        const diagnostic = page.locator('[data-ui="formula-preparation-warning"]');
        await expect(diagnostic).toContainText("glm-fixture-503");
        await expect(diagnostic).toContainText("local OCR diagnostic");
        await expect(diagnostic).not.toContainText(fixtureKey);
        glmMode = "wrong";
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        await expect(result.locator(".katex-display")).toHaveCount(0);
        await expect(diagnostic).toContainText(labels.translation.formulaIssue.characters);
        glmMode = "valid";
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        await checkBoth();
        await page.evaluate(
          (choice) =>
            localStorage.setItem(
              "cachalot:setting:formulaOcrModel",
              JSON.stringify({ ...choice, modelId: "removed-model" }),
            ),
          selectedOcr,
        );
        const beforeRemoved = glmRequests.length;
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        assert.equal(glmRequests.length, beforeRemoved);
        assert.equal(
          ocr().length,
          legacyRequests,
          "Missing OCR models never fall back to another paid provider",
        );
        await expect(diagnostic).toContainText(labels.messages.configureOcr);
        await page.getByRole("button", { name: labels.translation.close }).click();
        await choose("fixture-vision");
        await open();
        await expect(resultImages).toHaveCount(2);
        await expect(diagnostic).toContainText(labels.messages.configureOcr);
        assert.equal(
          ocr().length,
          legacyRequests,
          "Invalid explicit OCR cannot reuse legacy vision results or call that model",
        );
        await page.evaluate(() => localStorage.setItem("cachalot:setting:formulaOcrModel", "off"));
        await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
        await expect(copy).toBeEnabled();
        await expect(result.locator(".katex-display")).toHaveCount(0);
        await expect(resultImages).toHaveCount(2);
        await expect(diagnostic).toHaveCount(0);
        assert.equal(glmRequests.length, beforeRemoved);
        assert.equal(
          ocr().length,
          legacyRequests,
          "Turning OCR off retains source images even when a vision model has cached candidates",
        );
        await page.evaluate(
          (choice) =>
            localStorage.setItem("cachalot:setting:formulaOcrModel", JSON.stringify(choice)),
          selectedOcr,
        );
        await page.getByRole("button", { name: labels.translation.close }).click();
        await choose("fixture-text");
        // Both the independent OCR choice and its candidates survive reload.
        await page.reload();
        await page.locator('[data-ui="document-card"]').first().click();
        await page.locator('[data-ui="analysis-strip"][data-phase="ready"]').waitFor();
        await host.waitFor();
        await page.getByTitle(labels.reader.page.replace("{{page}}", "2"), { exact: true }).click();
        await page.waitForFunction(() => {
          const y = document
            .querySelector('[data-ui="pdf-page"][data-page="2"]')
            ?.getBoundingClientRect().y;
          return y !== undefined && y > 100 && y < 250;
        });
        await scroll.evaluate((node) => {
          node.scrollTop += 400;
        });
        await expect.poll(async () => (await host.boundingBox())!.y).toBeLessThan(0);
        const afterReload = glmRequests.length;
        await selectSwitching();
        await checkBoth();
        assert.equal(
          glmRequests.length,
          afterReload,
          "OCR selection and recognition cache survive reload",
        );
        assert.deepEqual(errors, []);
        console.log(
          `${language}: legacy evidence/LaTeX/fallback checks and GLM preset, independent OCR selection, crop transport, text translation, caching, diagnostics and invalid selection checks passed`,
        );
      } catch (error) {
        gate.recognition.release();
        gate.translation.release();
        await page.screenshot({
          path: `test-results/formula-transcription/failure-${language}.png`,
        });
        throw error;
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
}
