/** Exercise settings → composer with isolated data and a local model catalogue. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import { en } from "../fixtures/locales";
import { zh } from "../fixtures/locales";
import { loadReferencePaper } from "../support/reference-paper";
import { cacheFixture } from "../fixtures/cache";
import { seedPaper } from "../support/seed-paper";

test("Added models and composer @paper", async () => {
  const paper = process.env.CACHALOT_PAPER;
  if (!paper) {
    test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
    return;
  }
  const { analyses, observations, bytes } = await loadReferencePaper(paper);
  await mkdir("test-results/added-models", { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
  try {
    for (const language of ["zh", "en"] as const) {
      const labels = language === "zh" ? zh : en;
      const context = await browser.newContext({ viewport: { width: 1194, height: 834 } });
      try {
        const page = await context.newPage();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let requests = 0;
        await page.route("**/v1/models", (route) => {
          requests++;
          return route.fulfill({
            json: {
              data: [{ id: "default-model" }, { id: "vision-model" }, { id: "unadded-model" }],
            },
          });
        });
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
                  id: "fixture",
                  name: "Local fixture",
                  baseUrl: `${location.origin}/v1`,
                  modelId: "default-model",
                  enabled: true,
                  hasKey: false,
                },
              ]),
            );
            localStorage.removeItem("cachalot:setting:defaultModel");
            localStorage.setItem("cachalot:setting:activeProviderId", "fixture");
            localStorage.setItem("cachalot:setting:uiLanguage", language);
            // Ignore legacy full-catalogue caches and stale chat choices.
            localStorage.setItem(
              "cachalot:setting:models:fixture",
              JSON.stringify([{ id: "unadded-model" }]),
            );
            localStorage.setItem(
              "cachalot:setting:activeModel",
              JSON.stringify({ providerId: "fixture", modelId: "unadded-model" }),
            );
            localStorage.setItem("cachalot:setting:vision:model:fixture:vision-model", "true");
          },
          { id: analyses[0].documentId, language },
        );
        await seedPaper(page, { analyses, observations, bytes });
        await page.reload();
        const picker = page.getByRole("button", { name: labels.chat.chooseModel, exact: true });
        const menu = page.locator('[data-ui="model-menu"]');
        const openMenu = async () => {
          await picker.click();
          const provider = menu.getByRole("button", { name: "Local fixture", exact: true });
          if ((await provider.getAttribute("aria-expanded")) !== "true") await provider.click();
        };
        const openSettings = async () => {
          await openMenu();
          await page.getByTitle(labels.chat.modelSettings, { exact: true }).click();
        };
        const save = page.getByRole("button", { name: labels.common.save, exact: true });
        const back = () =>
          page.getByRole("button", { name: labels.settings.close, exact: true }).click();
        await page.locator('[data-ui="document-card"]').first().click();
        await expect(picker).toContainText("default-model");
        await openMenu();
        await expect(menu.getByRole("button", { name: "default-model", exact: true })).toHaveCount(
          1,
        );
        await expect(menu.getByRole("button", { name: "unadded-model", exact: true })).toHaveCount(
          0,
        );
        await page.keyboard.press("Escape");
        assert.equal(requests, 0, "Menu must not request the provider catalogue");

        await openSettings();
        await page.locator('[data-ui="api-key-input"]').fill("sk-fixture-only-abcd");
        await page.getByRole("button", { name: labels.settings.fetchModels, exact: true }).click();
        const drawer = page.locator('[data-ui="model-drawer"]');
        const row = drawer.locator('[data-ui="available-model"][data-model-id="vision-model"]');
        await row.getByRole("button", { name: labels.settings.addModel, exact: true }).click();
        await page.getByRole("button", { name: labels.common.done, exact: true }).click();
        await expect(drawer).toHaveCount(0);
        await expect(page.locator('[data-ui="added-model"]')).toHaveCount(2);
        assert.equal(requests, 1);
        await back();
        await openMenu();
        await expect(menu.getByRole("button", { name: "unadded-model", exact: true })).toHaveCount(
          0,
        );
        await menu.getByRole("button", { name: "vision-model", exact: true }).click();
        await expect(
          page.getByRole("button", { name: labels.chat.uploadImage, exact: true }),
        ).toBeEnabled();
        await page.screenshot({ path: `test-results/added-models/${language}-composer.png` });
        assert.equal(requests, 1);

        await openSettings();
        await page
          .getByRole("button", {
            name: labels.settings.removeModel.replace("{{model}}", "vision-model"),
            exact: true,
          })
          .click();
        await save.click();
        await expect(page.locator('[data-ui="added-model"]')).toHaveCount(1);
        await back();
        await expect(picker).toContainText("default-model");
        await openMenu();
        await expect(menu.getByRole("button", { name: "vision-model", exact: true })).toHaveCount(
          0,
        );
        await page.keyboard.press("Escape");
        assert.equal(
          await page.evaluate(() => localStorage.getItem("cachalot:setting:activeModel")),
          "",
        );

        // Manually saving an ID adds it without fetching anything.
        await openSettings();
        await page
          .getByRole("textbox", { name: labels.settings.modelId, exact: true })
          .fill("manual-model");
        await page.getByRole("button", { name: labels.settings.addModel, exact: true }).click();
        await save.click();
        await expect(page.locator('[data-ui="added-model"]')).toHaveCount(2);
        await page
          .getByRole("combobox", { name: labels.settings.defaultModel, exact: true })
          .selectOption(JSON.stringify({ providerId: "fixture", modelId: "manual-model" }));
        await back();
        await page.reload();
        await page.locator('[data-ui="document-card"]').first().click();
        await expect(picker).toContainText("manual-model");
        await openMenu();
        await expect(menu.getByRole("button", { name: "default-model", exact: true })).toHaveCount(
          1,
        );
        await expect(menu.getByRole("button", { name: "manual-model", exact: true })).toHaveCount(
          1,
        );
        await expect(menu.getByRole("button", { name: "vision-model", exact: true })).toHaveCount(
          0,
        );
        await expect(menu.getByRole("button", { name: "unadded-model", exact: true })).toHaveCount(
          0,
        );
        await page.screenshot({ path: `test-results/added-models/${language}-menu.png` });
        assert.equal(requests, 1, "Only the explicit settings action may fetch models");
        assert.deepEqual(errors, []);
      } finally {
        await context.close();
      }
    }
    console.log(
      "Added-model checks passed: legacy default, add/remove/manual save, reload, capabilities, no catalogue fetching in composer, zh/en.",
    );
  } finally {
    await browser.close();
  }
});

for (const language of ["zh", "en"] as const) {
  test(`Global default model: provider identity, current choice and capability drafts (${language})`, async () => {
    test.setTimeout(60_000);
    const labels = language === "en" ? en : zh;
    const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
    const context = await browser.newContext({ viewport: { width: 1194, height: 834 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.addInitScript((language) => {
        if (localStorage.getItem("model-fixture-seeded")) return;
        localStorage.setItem("model-fixture-seeded", "true");
        localStorage.setItem("cachalot:setting:uiLanguage", language);
        localStorage.setItem(
          "cachalot:providers",
          JSON.stringify([
            {
              id: "a",
              name: "Provider A",
              baseUrl: location.origin + "/a/v1",
              modelId: "image",
              enabled: true,
              hasKey: false,
            },
            {
              id: "b",
              name: "Provider B",
              baseUrl: location.origin + "/b/v1",
              modelId: "shared",
              enabled: true,
              hasKey: false,
            },
            {
              id: "disabled",
              name: "Disabled",
              baseUrl: location.origin + "/v1",
              modelId: "shared",
              enabled: false,
              hasKey: false,
            },
            {
              id: "ocr",
              name: "OCR",
              baseUrl: location.origin + "/v1",
              modelId: "ocr",
              enabled: true,
              hasKey: false,
            },
          ]),
        );
        localStorage.setItem(
          "cachalot:setting:addedModels:a",
          JSON.stringify([{ id: "shared" }, { id: "image" }]),
        );
        localStorage.setItem("cachalot:setting:providerPurpose:ocr", "ocr");
        localStorage.removeItem("cachalot:setting:defaultModel");
        localStorage.setItem("cachalot:setting:activeProviderId", "a");
        localStorage.setItem("cachalot:setting:vision:a", "true");
      }, language);
      let requests = 0;
      await page.route("**/chat/completions", (route) => {
        requests++;
        expect(new URL(route.request().url()).pathname).toBe("/b/v1/chat/completions");
        expect(route.request().postDataJSON().model).toBe("shared");
        return route.fulfill({
          contentType: "text/event-stream",
          body: 'data: {"choices":[{"delta":{"content":"Provider B reply"}}]}\n\ndata: [DONE]\n\n',
        });
      });
      await page.goto("/");
      const open = () =>
        page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      const close = () =>
        page.getByRole("button", { name: labels.settings.close, exact: true }).click();
      const selector = page.getByRole("combobox", {
        name: labels.settings.defaultModel,
        exact: true,
      });
      const aImage = JSON.stringify({ providerId: "a", modelId: "image" });
      const bShared = JSON.stringify({ providerId: "b", modelId: "shared" });
      const aShared = JSON.stringify({ providerId: "a", modelId: "shared" });
      await open();
      await expect(selector).toHaveValue(aImage);
      expect(await selector.locator("option").allTextContents()).toEqual([
        labels.settings.defaultModelUnset,
        "Provider A/shared",
        "Provider A/image",
        "Provider B/shared",
      ]);
      await expect(
        page.getByRole("button", { name: /^(设为默认|Set as default)$/, exact: true }),
      ).toHaveCount(0);
      const imageFlag = page.getByRole("checkbox", {
        name: labels.settings.modelVision.replace("{{model}}", "image"),
        exact: true,
      });
      await expect(imageFlag).toBeChecked();
      const sharedFlag = page.getByRole("checkbox", {
        name: labels.settings.modelVision.replace("{{model}}", "shared"),
        exact: true,
      });
      await expect(sharedFlag).not.toBeChecked();
      await sharedFlag.check();
      await page
        .getByRole("textbox", { name: labels.settings.modelId, exact: true })
        .fill("manual");
      await page.getByRole("button", { name: labels.settings.addModel, exact: true }).click();
      // Language/category changes keep the model and capability draft.
      await page.getByRole("button", { name: labels.settings.general, exact: true }).click();
      await page.getByRole("button", { name: labels.settings.providers, exact: true }).click();
      await expect(sharedFlag).toBeChecked();
      await expect(page.locator('[data-ui="added-model"][data-model-id="manual"]')).toBeVisible();
      await expect(selector.locator("option", { hasText: "Provider A/manual" })).toHaveCount(0);
      await page.getByRole("button", { name: labels.common.save, exact: true }).click();
      await expect(selector.locator("option", { hasText: "Provider A/manual" })).toHaveCount(1);
      await expect(selector).toHaveValue(aImage);
      await selector.selectOption(bShared);
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("cachalot:setting:defaultModel")))
        .toBe(bShared);
      await close();
      await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
        name: "models.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(cacheFixture.pdfBytes),
      });
      await expect(page.locator('[data-ui="pdf-page"]')).toBeVisible();
      const picker = page.getByRole("button", { name: labels.chat.chooseModel, exact: true });
      await expect(picker).toContainText("shared");
      const composer = page.locator('[data-ui="chat-composer"] textarea');
      await composer.fill("Check the default provider");
      await composer.press("Enter");
      await expect(page.getByText("Provider B reply", { exact: true })).toBeVisible();
      expect(requests).toBe(1);
      await picker.click();
      const menu = page.locator('[data-ui="model-menu"]');
      await menu.getByRole("button", { name: "Provider A", exact: true }).click();
      await menu.getByRole("button", { name: "shared", exact: true }).click();
      await expect(
        page.getByRole("button", { name: labels.chat.uploadImage, exact: true }),
      ).toBeEnabled();
      await open();
      await expect(selector).toHaveValue(bShared);
      await page.screenshot({ path: `test-results/default-model/${language}-settings.png` });
      await close();
      await page.reload();
      await page.locator('[data-ui="document-card"]').click();
      await expect(picker).toContainText("shared");
      expect(await page.evaluate(() => localStorage.getItem("cachalot:setting:activeModel"))).toBe(
        aShared,
      );
      await open();
      await expect(selector).toHaveValue(bShared);
      await selector.selectOption(aImage);
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("cachalot:setting:activeModel")))
        .toBe("");
      await close();
      await expect(picker).toContainText("image");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });

  test(`Global default model: model switches save immediately and invalid defaults stay unset (${language})`, async () => {
    test.setTimeout(60_000);
    const labels = language === "en" ? en : zh;
    const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto("/");
      await page.evaluate((language) => {
        localStorage.setItem("cachalot:setting:uiLanguage", language);
        localStorage.setItem(
          "cachalot:providers",
          JSON.stringify([
            {
              id: "a",
              name: "Provider A",
              baseUrl: location.origin + "/v1",
              modelId: "shared",
              enabled: true,
              hasKey: false,
            },
            {
              id: "b",
              name: "Provider B",
              baseUrl: location.origin + "/v1",
              modelId: "shared",
              enabled: true,
              hasKey: false,
            },
          ]),
        );
        localStorage.setItem(
          "cachalot:setting:addedModels:b",
          JSON.stringify([
            { id: "shared", enabled: true },
            { id: "math", enabled: false, formulaOcr: "formula-chat" },
          ]),
        );
        localStorage.setItem(
          "cachalot:setting:defaultModel",
          JSON.stringify({ providerId: "a", modelId: "shared" }),
        );
        localStorage.setItem(
          "cachalot:setting:activeModel",
          JSON.stringify({ providerId: "a", modelId: "shared" }),
        );
      }, language);
      await page.reload();
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      const selector = page.getByRole("combobox", {
        name: labels.settings.defaultModel,
        exact: true,
      });
      await page
        .getByRole("button", {
          name: labels.settings.removeModel.replace("{{model}}", "shared"),
          exact: true,
        })
        .click();
      await page.getByRole("button", { name: labels.common.save, exact: true }).click();
      await expect(selector).toHaveValue("");
      await expect(selector).toBeEnabled();
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("cachalot:setting:defaultModel")))
        .toBe("null");
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("cachalot:setting:activeModel")))
        .toBe("");
      await selector.selectOption(JSON.stringify({ providerId: "b", modelId: "shared" }));
      await page.getByRole("button", { name: /Provider B/ }).click();
      const toggle = page.getByRole("switch", {
        name: labels.settings.modelEnabled.replace("{{model}}", "shared"),
        exact: true,
      });
      await expect(toggle).toBeChecked();
      await toggle.press("Space");
      await expect(toggle).not.toBeChecked();
      await page.screenshot({ path: `test-results/default-model/${language}-model-switches.png` });
      // No provider save is needed, and no other same-named model becomes the default.
      await expect(selector).toHaveValue("");
      await expect(selector).toBeDisabled();
      await expect(selector).toContainText(labels.settings.defaultModelUnset);
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("cachalot:setting:defaultModel")))
        .toBe("null");
      await toggle.press("Space");
      await expect(toggle).toBeChecked();
      await expect(selector).toBeEnabled();
      await expect(selector).toHaveValue("");
      await page.reload();
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      await expect(selector).toBeEnabled();
      await expect(selector).toHaveValue("");
      await expect(
        page.getByRole("checkbox", { name: labels.settings.enableProvider, exact: true }),
      ).toHaveCount(0);
      // Disabled OCR models in a mixed provider remain manageable and can be reenabled.
      await page.getByRole("button", { name: labels.ocr.title, exact: true }).click();
      const ocrEditor = page.locator('[data-ui="ocr-provider-editor"]');
      await expect(ocrEditor.getByRole("button", { name: /Provider B/ })).toBeVisible();
      const ocrToggle = ocrEditor.getByRole("switch", {
        name: labels.settings.modelEnabled.replace("{{model}}", "math"),
        exact: true,
      });
      await expect(ocrToggle).not.toBeChecked();
      await ocrToggle.press("Space");
      await expect(ocrToggle).toBeChecked();
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
