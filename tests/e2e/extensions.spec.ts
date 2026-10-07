import { chromium, expect, test } from "@playwright/test";
import { cacheFixture } from "../fixtures/cache";
import { en, zh } from "../fixtures/locales";

test("late startup activation selects the default tool but respects an explicit text choice", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
  try {
    for (const chooseText of [false, true]) {
      const context = await browser.newContext();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        const page = await context.newPage();
        await page.route(
          "**/src/extensions/selection-translation/extension.tsx*",
          async (route) => {
            await gate;
            await route.continue();
          },
        );
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
          name: "late-extension.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(cacheFixture.pdfBytes),
        });
        await expect(page.locator('[data-ui="pdf-page"]')).toBeVisible();
        const text = page.getByRole("button", { name: zh.reader.text, exact: true });
        await expect(text).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("button", { name: zh.reader.region, exact: true })).toHaveCount(
          0,
        );
        if (chooseText) await text.click();
        release();
        await expect(
          page.getByRole("button", { name: zh.reader.region, exact: true }),
        ).toHaveAttribute("aria-pressed", String(!chooseText));
        await expect(text).toHaveAttribute("aria-pressed", String(chooseText));
      } finally {
        release();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
});

for (const language of ["zh", "en"] as const) {
  test(`Extension lifecycle, core reading/chat and registered views (${language})`, async () => {
    test.setTimeout(90_000);
    const labels = language === "en" ? en : zh;
    const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.route("**/v1/models", (route) =>
        route.fulfill({ json: { data: [{ id: "fixture-model" }] } }),
      );
      await page.route("**/v1/chat/completions", (route) =>
        route.fulfill({
          contentType: "text/event-stream",
          body: 'data: {"choices":[{"delta":{"content":"Core assistant fixture reply"}}]}\n\ndata: [DONE]\n\n',
        }),
      );
      await page.goto("/");
      await page.evaluate((language) => {
        localStorage.setItem("cachalot:setting:uiLanguage", language);
        localStorage.setItem(
          "cachalot:setting:translationPrompt",
          "Preserved translation prompt fixture",
        );
        localStorage.setItem(
          "cachalot:providers",
          JSON.stringify([
            {
              id: "fixture-model",
              name: "Fixture model",
              baseUrl: location.origin + "/v1",
              modelId: "fixture-model",
              enabled: true,
              hasKey: false,
            },
          ]),
        );
        localStorage.removeItem("cachalot:setting:defaultModel");
        localStorage.setItem("cachalot:setting:activeProviderId", "fixture-model");
      }, language);
      await page.reload();
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      await page.getByRole("button", { name: labels.settings.translation, exact: true }).click();
      await expect(page.locator("#translation-prompt")).toHaveValue(
        "Preserved translation prompt fixture",
      );
      await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
      await expect(
        page.locator('[data-extension-id="cachalot.selection-translation"]'),
      ).toContainText(labels.extensions.builtIn);
      await page.getByRole("button", { name: labels.extensions.disable, exact: true }).click();
      await expect(
        page.getByRole("button", { name: labels.settings.translation, exact: true }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: labels.ocr.title, exact: true }).click();
      await expect(page.locator('[data-ui="ocr-settings"]')).toBeVisible();
      await page.getByRole("button", { name: labels.settings.close, exact: true }).click();
      await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
        name: "extension-fixture.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(cacheFixture.pdfBytes),
      });
      const host = page.locator('[data-ui="pdf-page"][data-page="1"]');
      await expect(host).toHaveAttribute("data-rendered", "true", { timeout: 30000 });
      await expect(
        page.getByRole("button", { name: labels.reader.region, exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: labels.reader.text, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      const composer = page.locator('[data-ui="chat-composer"] textarea');
      await composer.fill("Summarize the paper");
      await composer.press("Enter");
      await expect(page.locator('[data-ui="chat-panel"]')).toContainText(
        "Core assistant fixture reply",
      );
      // Exercise a separate extension through the same SDK, with real dock/tree/webview UI.
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const runtimeUrl =
          performance
            .getEntriesByType("resource")
            .find(
              (entry) => new URL(entry.name).pathname === "/src/application/extensions/runtime.ts",
            )?.name || "/src/application/extensions/runtime.ts";
        const { extensionHost } = await load(runtimeUrl);
        const { extensionFixtureManifest, fixtureExtension } = await load(
          "/tests/fixtures/extensions.ts",
        );
        await extensionHost.install({
          manifest: extensionFixtureManifest,
          builtIn: false,
          load: async () => fixtureExtension(),
        });
      });
      const installed = await page.evaluate(async () => {
        const runtimeUrl =
          performance
            .getEntriesByType("resource")
            .find(
              (entry) => new URL(entry.name).pathname === "/src/application/extensions/runtime.ts",
            )?.name || "/src/application/extensions/runtime.ts";
        const { extensionHost } = await import(/* @vite-ignore */ runtimeUrl);
        return extensionHost
          .getSnapshot()
          .extensions.map((item: { id: string; status: string; error?: string }) => ({
            id: item.id,
            status: item.status,
            error: item.error,
          }));
      });
      expect(installed).toContainEqual({
        id: "fixture.reader-tools",
        status: "active",
        error: undefined,
      });
      await expect(page.getByRole("treeitem")).toContainText(
        language === "en" ? "Page 1" : "第 1 页",
      );
      const panel = page.locator('[data-ui="extension-dock"][data-location="panel"]');
      await expect(panel).toBeVisible();
      const frame = panel.frameLocator("iframe");
      await frame.getByRole("button", { name: "Ping host" }).click();
      await expect(frame.locator("#result")).toHaveText("Host replied");
      await expect(page.locator('[data-ui="extension-statusbar"]')).toContainText(
        language === "en" ? "Extension ready" : "插件已就绪",
      );
      await page
        .locator('[data-ui="extension-dock"][data-location="sidebar.left"]')
        .getByRole("combobox", { name: labels.extensions.moveView })
        .selectOption("sidebar.right");
      await expect(
        page.locator('[data-ui="extension-dock"][data-location="sidebar.right"]'),
      ).toBeVisible();
      await expect(
        page.locator('[data-ui="extension-dock"][data-location="sidebar.left"]'),
      ).toHaveCount(0);
      await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const runtimeUrl =
          performance
            .getEntriesByType("resource")
            .find(
              (entry) => new URL(entry.name).pathname === "/src/application/extensions/runtime.ts",
            )?.name || "/src/application/extensions/runtime.ts";
        const { extensionHost } = await load(runtimeUrl);
        await extensionHost.setEnabled("fixture.reader-tools", false);
      });
      await expect(page.locator('[data-ui="extension-dock"]')).toHaveCount(0);
      await expect(page.locator('[data-ui="extension-statusbar"]')).toHaveCount(0);
      // Reload verifies disabled state and migrated settings persist, then enable the built-in again.
      await page.reload();
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
      await page
        .locator('[data-extension-id="cachalot.selection-translation"]')
        .getByRole("button", { name: labels.extensions.enable, exact: true })
        .click();
      await page.getByRole("button", { name: labels.settings.translation, exact: true }).click();
      await expect(page.locator("#translation-prompt")).toHaveValue(
        "Preserved translation prompt fixture",
      );
      await page.getByRole("button", { name: labels.settings.close, exact: true }).click();
      await page.locator('[data-ui="document-card"]').click();
      await expect(
        page.getByRole("button", { name: labels.reader.region, exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await browser.close();
    }
  });
}
