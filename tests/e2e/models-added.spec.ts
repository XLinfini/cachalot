/** Exercise settings → composer with isolated data and a local model catalogue. */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect, test } from "@playwright/test";
import { en } from "../../src/i18n/locales/en";
import { zh } from "../../src/i18n/locales/zh";
import { loadReferencePaper } from "../support/reference-paper";
import { seedPaper } from "../support/seed-paper";

test("Added models and composer @paper", async () => {
  const paper = process.env.CACHALOT_PAPER;
  if (!paper) {
    test.skip(true, "Set CACHALOT_PAPER to run the real-paper suite");
    return;
  }
  const { analyses, bytes } = await loadReferencePaper(paper);
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
        await seedPaper(page, { analyses, bytes });
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
          page.getByRole("button", { name: labels.common.backLibrary, exact: true }).click();
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
        await save.click();
        await expect(page.locator('[data-ui="added-model"]')).toHaveCount(2);
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
