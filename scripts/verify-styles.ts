/** Visual migration checks. Fixtures live only in an isolated browser profile. */
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { ANALYSIS_CACHE_KEY } from "../src/domain/model";
import type { PageAnalysis } from "../src/domain/analysis";
import { en } from "../src/i18n/locales/en";
import { zh } from "../src/i18n/locales/zh";
import { verifyContinuousReader } from "./verify-continuous-reader";
import { verifyModelComposer } from "./verify-model-composer";
import { verifyFormulas } from "./verify-formulas";

const paper = process.argv[2];
if (!paper) throw new Error("用法：npm run test:styles -- /absolute/path/reference.pdf");
const directory = "test-results/styles-after";
await mkdir(directory, { recursive: true });
// This fixture comes from test:paper. Parsing quality is covered separately;
// the style check reuses analysis to avoid loading a model in every viewport.
const analyses: PageAnalysis[] = JSON.parse(
  await readFile("test-results/paper-analysis.json", "utf8"),
);
const bytes = Array.from(await readFile(paper));
const id = analyses[0].documentId;
const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
const errors: string[] = [];
const measurements: unknown[] = [];
const selector = (name: string) => `[data-ui="${name}"]`;
try {
  for (const language of ["zh", "en"] as const) {
    const labels = language === "en" ? en : zh;
    const output = language === "en" ? "test-results/styles-en" : directory;
    await mkdir(output, { recursive: true });
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 1194, height: 834 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/v1/models", (route) =>
        route.fulfill({
          json: {
            data: [
              { id: "test-academic-model", owned_by: "Local fixture" },
              { id: "test-vision-model" },
            ],
          },
        }),
      );
      await page.route("**/v1/chat/completions", (route) => {
        const body = route.request().postDataJSON();
        const user = body.messages.at(-1)?.content;
        const text =
          typeof user === "string"
            ? user
            : user?.find((part: { type: string }) => part.type === "text")?.text || "";
        const markers =
          text.split("\n\n公式阅读辅助")[0].match(/\[\[formula:[a-zA-Z0-9-]+\]\]/g) || [];
        const transcription = String(body.messages[0]?.content).startsWith("仅转写");
        const answer = transcription
          ? JSON.stringify(
              user
                .filter((part: { type: string }) => part.type === "text")
                .map((part: { text: string }) => ({
                  id: JSON.parse(part.text).id,
                  latex: "C\\approx\\frac{0.2\\cdot I_{op}}{2\\pi\\cdot f_o\\cdot V_{op}}",
                })),
            )
          : `这是用于检查样式的译文。\n\n$$V = I R$$\n\n- 保留公式\n- 核对原文${markers.length ? `\n\n${markers.join("\n\n")}` : ""}`;
        return route.fulfill({
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`,
        });
      });
      await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
      await page.evaluate(
        async ({ analyses, bytes, id, key }) => {
          const now = Math.floor(Date.now() / 1000);
          const document = {
            id,
            title:
              "Design, Control and Performance of Tracking Power Supply for a Linear Power Amplifier",
            fileName: "reference.pdf",
            pageCount: 7,
            currentPage: 1,
            starred: false,
            createdAt: now,
            updatedAt: now,
          };
          localStorage.setItem(
            "cachalot:documents",
            JSON.stringify([
              document,
              {
                ...document,
                id: "cover-fixture",
                title: "Long academic title for checking card wrapping and truncation",
                fileName: "second-paper.pdf",
                starred: true,
                updatedAt: now - 60,
              },
            ]),
          );
          localStorage.setItem(
            "cachalot:providers",
            JSON.stringify([
              {
                id: "fixture-provider",
                name: "本地样式测试",
                baseUrl: `${location.origin}/v1`,
                modelId: "test-academic-model",
                enabled: true,
                hasKey: false,
              },
              {
                id: "second-provider",
                name: "另一个提供商",
                baseUrl: `${location.origin}/second/v1`,
                modelId: "other-model",
                enabled: true,
                hasKey: false,
              },
            ]),
          );
          localStorage.setItem("cachalot:setting:activeProviderId", "fixture-provider");
          localStorage.setItem(
            "cachalot:setting:addedModels:fixture-provider",
            JSON.stringify([{ id: "test-academic-model" }, { id: "test-vision-model" }]),
          );
          localStorage.setItem(
            "cachalot:setting:vision:model:fixture-provider:test-vision-model",
            "true",
          );
          localStorage.setItem("cachalot:setting:uiLanguage", "unsupported-language");
          localStorage.setItem(
            "cachalot:threads",
            JSON.stringify([
              {
                id: "fixture-thread",
                documentId: id,
                title: "图表与公式核对",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ]),
          );
          localStorage.setItem(
            "cachalot:messages",
            JSON.stringify([
              {
                id: "q",
                threadId: "fixture-thread",
                role: "user",
                content: "解释论文的主要贡献和公式。",
                createdAt: Date.now(),
              },
              {
                id: "a",
                threadId: "fixture-thread",
                role: "assistant",
                content:
                  "### 电源设计\n\n用于检查样式的回答。\n\n- 双栏正文\n- 图表和公式\n\n$$P = V I$$\n\n```ts\nconst power = voltage * current;\n```",
                createdAt: Date.now() + 1,
              },
            ]),
          );
          const pdf = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open("cachalot-pdfs", 1);
            r.onupgradeneeded = () => r.result.createObjectStore("pdfs");
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = pdf.transaction("pdfs", "readwrite");
            tx.objectStore("pdfs").put(new Uint8Array(bytes).buffer, id);
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
          pdf.close();
          const cache = await new Promise<IDBDatabase>((resolve, reject) => {
            const r = indexedDB.open("cachalot-analysis", 1);
            r.onupgradeneeded = () => {
              const s = r.result.createObjectStore("pages", {
                keyPath: ["documentId", "cacheKey", "page"],
              });
              s.createIndex("documentId", "documentId");
            };
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
          });
          await new Promise<void>((resolve, reject) => {
            const tx = cache.transaction("pages", "readwrite");
            for (const entry of analyses) tx.objectStore("pages").put({ ...entry, cacheKey: key });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
          });
          cache.close();
        },
        { analyses, bytes, id, key: ANALYSIS_CACHE_KEY },
      );
      await page.reload();
      await page.locator(selector("document-card")).first().waitFor();
      // Switch through the actual settings UI; reload must restore the preference.
      // Unsaved form content must survive the language switch within settings.
      await page
        .locator(selector("app-nav"))
        .getByRole("button", { name: zh.common.settings, exact: true })
        .click();
      await page
        .getByRole("textbox", { name: zh.settings.providerName, exact: true })
        .fill("Unsaved provider draft");
      await page.getByRole("button", { name: zh.settings.general, exact: true }).click();
      await page.getByRole("combobox").selectOption("en");
      await page.getByRole("heading", { name: en.settings.generalTitle }).waitFor();
      await page.getByRole("button", { name: en.settings.providers, exact: true }).click();
      assert.equal(
        await page
          .getByRole("textbox", { name: en.settings.providerName, exact: true })
          .inputValue(),
        "Unsaved provider draft",
      );
      await page.getByRole("button", { name: en.settings.translation, exact: true }).click();
      await page
        .getByRole("textbox", { name: en.settings.prompt, exact: true })
        .fill("Keep this custom prompt exactly as written.");
      await page.getByRole("button", { name: en.settings.general, exact: true }).click();
      await page.getByRole("combobox").selectOption("zh");
      await page.getByRole("heading", { name: zh.settings.generalTitle }).waitFor();
      await page.getByRole("button", { name: zh.settings.translation, exact: true }).click();
      assert.equal(
        await page.getByRole("textbox", { name: zh.settings.prompt, exact: true }).inputValue(),
        "Keep this custom prompt exactly as written.",
      );
      await page.getByRole("button", { name: zh.settings.general, exact: true }).click();
      if (language === "en") await page.getByRole("combobox").selectOption("en");
      await page.getByRole("heading", { name: labels.settings.generalTitle }).waitFor();
      await page.screenshot({ path: `${output}/language-${viewport.width}.png` });
      await page.reload();
      await page.getByRole("heading", { name: labels.library.title, exact: false }).waitFor();
      assert.equal(
        await page.locator("html").getAttribute("lang"),
        language === "en" ? "en-US" : "zh-CN",
      );
      assert.equal(
        await page.evaluate(() => localStorage.getItem("cachalot:setting:uiLanguage")),
        language,
      );
      await page.locator('[data-ui="document-preview"]').first().waitFor();
      await page.screenshot({ path: `${output}/library-${viewport.width}.png` });
      await page.locator(selector("document-card")).first().click();
      await page
        .locator(selector("analysis-strip"))
        .filter({ hasText: labels.messages.analysisSaved })
        .waitFor();
      await page.waitForFunction(
        () => !!document.querySelector<HTMLCanvasElement>("canvas[style]")?.width,
      );
      await page.getByRole("button", { name: labels.reader.layout, exact: true }).click();
      assert.match(
        await page.locator('[data-ui="layout-box"][data-kind="figure"]').first().innerText(),
        new RegExp(labels.reader.blocks.figure),
      );
      await page.screenshot({ path: `${output}/reader-${viewport.width}.png` });
      const geometry = await page.locator('[data-ui="pdf-page"][data-page="1"]').boundingBox();
      assert.ok(geometry && geometry.width > 500 && geometry.height > 700);
      // Exercise the generated PDF.js text layer after the pointer-event styles
      // move to Tailwind. A real drag must still select the visible PDF text.
      await page.getByRole("button", { name: labels.reader.text, exact: true }).click();
      const line = page.locator(".textLayer span").filter({ hasText: "Design, Control" }).first();
      await line.waitFor();
      const lineBounds = await line.boundingBox();
      assert.ok(lineBounds);
      await page.mouse.move(lineBounds.x + 2, lineBounds.y + lineBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        lineBounds.x + lineBounds.width * 0.7,
        lineBounds.y + lineBounds.height / 2,
        { steps: 8 },
      );
      await page.mouse.up();
      assert.match(await page.evaluate(() => window.getSelection()?.toString() || ""), /Design/);
      await page.evaluate(() => window.getSelection()?.removeAllRanges());
      await page.getByRole("button", { name: labels.reader.region, exact: true }).click();
      const body = analyses[0].blocks.find(
        (b) => b.kind === "paragraph" && b.characterIndices.length > 200,
      )!;
      await page.mouse.move(
        geometry.x + body.box[0] * geometry.width,
        geometry.y + body.box[1] * geometry.height,
      );
      await page.mouse.down();
      await page.mouse.move(
        geometry.x + ((body.box[0] + body.box[2]) / 2) * geometry.width,
        geometry.y + body.box[3] * geometry.height,
        { steps: 5 },
      );
      await page.mouse.up();
      await page.getByRole("button", { name: labels.reader.translate }).click();
      await page
        .locator(selector("translation-result"))
        .getByText("这是用于检查样式的译文。")
        .waitFor();
      await page.screenshot({ path: `${output}/translation-${viewport.width}.png` });
      await page.getByRole("button", { name: labels.translation.close }).click();
      await verifyModelComposer(page, labels, output, viewport.width);
      if (viewport.width === 1440) await verifyFormulas(page, labels, output);
      await verifyContinuousReader(page, analyses, labels, output, viewport.width);
      await page.getByRole("button", { name: labels.chat.chooseModel, exact: true }).click();
      await page.getByTitle(labels.chat.modelSettings, { exact: true }).click();
      await page.getByRole("button", { name: labels.settings.fetchModels }).waitFor();
      await page.screenshot({ path: `${output}/providers-${viewport.width}.png` });
      const enabled = page.getByRole("checkbox", {
        name: labels.settings.enableProvider,
        exact: true,
      });
      await enabled.focus();
      await page.keyboard.press("Space");
      assert.equal(await enabled.isChecked(), false, "provider switch supports keyboard input");
      await page.keyboard.press("Space");
      assert.equal(await enabled.isChecked(), true);
      await page.getByRole("button", { name: labels.settings.fetchModels }).click();
      await page.getByRole("heading", { name: labels.settings.chooseModel, exact: true }).waitFor();
      await page.screenshot({ path: `${output}/model-drawer-${viewport.width}.png` });
      await page.getByRole("button", { name: labels.common.done, exact: true }).click();
      await page.getByRole("button", { name: labels.settings.translation, exact: true }).click();
      await page.screenshot({ path: `${output}/prompt-${viewport.width}.png` });
      measurements.push({
        language,
        viewport,
        pdf: geometry,
        horizontalOverflow: await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
      });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  await writeFile(`${directory}/measurements.json`, JSON.stringify(measurements, null, 2));
  console.log(
    JSON.stringify({
      languages: 2,
      viewports: 2,
      screenshots: 56,
      continuousReader: true,
      errors,
      measurements,
    }),
  );
} finally {
  await browser.close();
}
