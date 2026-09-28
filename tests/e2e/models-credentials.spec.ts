/** Check credential editing with fake keys in isolated browser profiles. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { en } from "../../src/i18n/locales/en";
import { zh } from "../../src/i18n/locales/zh";

test("Provider credentials", async () => {
  const errors: string[] = [];
  const fakeKey = "sk-fixture-only-never-a-real-credential-abcd";
  const replacement = "sk-replacement-fixture-only-wxyz";
  await mkdir("test-results/api-key", { recursive: true });
  const profiles: string[] = [];
  try {
    for (const language of ["zh", "en"] as const) {
      const labels = language === "zh" ? zh : en;
      const profile = await mkdtemp(join(tmpdir(), "cachalot-key-fixture-"));
      profiles.push(profile);
      const launch = () =>
        chromium.launchPersistentContext(profile, {
          executablePath: process.env.CACHALOT_CHROMIUM,
          viewport: { width: language === "zh" ? 1440 : 1194, height: 1000 },
        });
      const context = await launch();
      try {
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/v1/models", (route) =>
          route.fulfill({ json: { data: [{ id: "fixture-model" }] } }),
        );
        await page.addInitScript(
          ({ language }) => {
            if (localStorage.getItem("fixture-seeded")) return;
            localStorage.setItem("fixture-seeded", "true");
            localStorage.setItem("cachalot:setting:uiLanguage", language);
            localStorage.setItem(
              "cachalot:providers",
              JSON.stringify([
                {
                  id: "key-fixture",
                  name: "Key fixture",
                  baseUrl: `${location.origin}/v1`,
                  modelId: "fixture-model",
                  enabled: true,
                  hasKey: false,
                },
                {
                  id: "second-fixture",
                  name: "Other fixture",
                  baseUrl: `${location.origin}/v1`,
                  modelId: "fixture-model",
                  enabled: true,
                  hasKey: false,
                },
              ]),
            );
          },
          { language },
        );
        await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
        const openSettings = () =>
          page.getByRole("button", { name: labels.common.settings, exact: true }).first().click();
        await openSettings();
        const input = page.locator('[data-ui="api-key-input"]');
        const toggle = page.locator('[data-ui="api-key-toggle"]');
        const save = page.getByRole("button", { name: labels.common.save, exact: true });
        await expect(input).toHaveAttribute("type", "password");
        await input.fill(fakeKey);
        await toggle.click();
        await expect(input).toHaveAttribute("type", "text");
        await expect(input).toHaveValue(fakeKey);
        await toggle.click();
        await expect(input).toHaveAttribute("type", "password");
        await save.click();
        await expect(input).toHaveValue("sk-...abcd");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await expect(toggle).toHaveAccessibleName(labels.settings.showKey);
        await toggle.click();
        await expect(input).toHaveValue(fakeKey);
        await expect(toggle).toHaveAccessibleName(labels.settings.hideKey);
        await expect(page.getByText(labels.settings.keyPending, { exact: true })).toHaveCount(0);
        // Saving a revealed value must still preserve the existing credential.
        await save.click();
        await expect(input).toHaveValue("sk-...abcd");

        // Focusing and abandoning a replacement also preserves the stored key.
        await input.focus();
        await expect(input).toHaveValue("");
        await expect(input).toHaveAttribute("type", "password");
        await save.click();
        await expect(input).toHaveValue("sk-...abcd");
        const checkAuth = async (key: string) => {
          const request = page.waitForRequest((request) => request.url().endsWith("/v1/models"));
          await page
            .getByRole("button", { name: labels.settings.testConnection, exact: true })
            .click();
          assert.equal(
            (await request).headers().authorization,
            `Bearer ${key}`,
            "display mask must never replace the credential",
          );
          await expect(save).toBeEnabled();
        };
        await checkAuth(fakeKey);

        await toggle.click();
        await expect(input).toHaveValue(fakeKey);
        await page.getByRole("button", { name: /Other fixture/ }).click();
        await expect(input).toHaveValue("");
        await expect(input).toHaveAttribute("type", "password");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await page.getByRole("button", { name: /Key fixture/ }).click();
        await expect(input).toHaveValue("sk-...abcd");

        // A genuine replacement must be saved, masked and used in requests.
        await input.fill(replacement);
        await save.click();
        await expect(input).toHaveValue("sk-...wxyz");
        await checkAuth(replacement);
        const persisted = await page.evaluate(() => JSON.stringify(localStorage));
        assert.ok(
          !persisted.includes(fakeKey) && !persisted.includes(replacement),
          "raw credentials must not enter localStorage",
        );
        await toggle.click();
        await expect(input).toHaveValue(replacement);
        await page.getByRole("button", { name: labels.common.backLibrary, exact: true }).click();
        await openSettings();
        await expect(input).toHaveValue("sk-...wxyz");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        // The previous memory-only implementation lost the key on this reload.
        await page.reload();
        await openSettings();
        await expect(input).toHaveValue("sk-...wxyz");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await checkAuth(replacement);
        await page.screenshot({ path: `test-results/api-key/${language}.png` });
      } finally {
        await context.close();
      }

      // Closing the whole browser process also releases the in-memory CryptoKey.
      // The second launch uses only this temporary profile's durable storage.
      const restarted = await launch();
      try {
        const page = await restarted.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/v1/models", (route) => route.fulfill({ json: { data: [] } }));
        await page.goto(process.env.CACHALOT_URL || "http://127.0.0.1:1420/");
        await page
          .getByRole("button", { name: labels.common.settings, exact: true })
          .first()
          .click();
        const input = page.locator('[data-ui="api-key-input"]');
        const toggle = page.locator('[data-ui="api-key-toggle"]');
        await expect(input).toHaveValue("sk-...wxyz");
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        const request = page.waitForRequest((request) => request.url().endsWith("/v1/models"));
        await page
          .getByRole("button", { name: labels.settings.testConnection, exact: true })
          .click();
        assert.equal((await request).headers().authorization, `Bearer ${replacement}`);
        await toggle.click();
        await expect(input).toHaveValue(replacement);
      } finally {
        await restarted.close();
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      "API key checks passed: masked display, reveal/hide, replacement, blank-save preservation, reload, browser restart, request credentials, zh/en.",
    );
  } finally {
    for (const profile of profiles) await rm(profile, { recursive: true, force: true });
  }
});
