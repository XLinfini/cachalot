import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageExtension } from "../../scripts/package-extension";
import { chromium, expect, test } from "@playwright/test";
import {
  consumerPackage,
  providerPackage,
  stuckPackage,
  extensionArchive,
  eventPackage,
  workbenchPackage,
} from "../fixtures/extension-packages";
import { cacheFixture, cacheFixturePdf } from "../fixtures/cache";
import { en, zh } from "../fixtures/locales";

for (const language of ["zh", "en"] as const) {
  test(`local installation, dependency updates and extension restart preserve core work (${language})`, async () => {
    test.setTimeout(100000);
    const labels = language === "en" ? en : zh,
      browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage();
    const deactivations: string[] = [];
    page.on("console", (message) => {
      if (message.text().includes("Fixture consumer deactivated"))
        deactivations.push(message.text());
    });
    const errors: string[] = [],
      failedCore: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => {
      if (request.url().includes("/core/chat/completions"))
        failedCore.push(request.failure()?.errorText || "failed");
    });
    let release!: () => void, requested!: () => void;
    const gate = new Promise<void>((resolve) => {
        release = resolve;
      }),
      requestReady = new Promise<void>((resolve) => {
        requested = resolve;
      });
    try {
      await page.addInitScript(
        ({ language }) => {
          if (window.top !== window) return;
          localStorage.setItem("cachalot:setting:uiLanguage", language);
          localStorage.setItem(
            "cachalot:providers",
            JSON.stringify([
              {
                id: "fixture-model",
                name: "Fixture model",
                baseUrl: location.origin + "/core",
                modelId: "fixture-model",
                enabled: true,
                hasKey: false,
              },
            ]),
          );
          localStorage.setItem("cachalot:setting:activeProviderId", "fixture-model");
        },
        { language },
      );
      await page.route("**/core/models", (route) =>
        route.fulfill({ json: { data: [{ id: "fixture-model" }] } }),
      );
      await page.route("**/core/chat/completions", async (route) => {
        const body = route.request().postDataJSON();
        if (
          body.messages?.some(
            (message: { content: unknown }) => message.content === "Keep the core running",
          )
        ) {
          requested();
          await gate;
        }
        await route.fulfill({
          contentType: "text/event-stream",
          body: 'data: {"choices":[{"delta":{"content":"Core stream survived"}}]}\n\ndata: [DONE]\n\n',
        });
      });
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: labels.common.settings, exact: true }),
      ).toBeVisible();
      await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
        name: "install-fixture.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(cacheFixture.pdfBytes),
      });
      await expect(page.locator('[data-ui="pdf-page"]')).toHaveAttribute("data-rendered", "true");
      await page.evaluate(() => {
        (window as any).readerBefore = document.querySelector('[data-ui="pdf-page"]');
        (window as any).navigationBefore = performance.timeOrigin;
      });
      await page.getByPlaceholder(labels.chat.placeholder).fill("Keep the core running");
      await page.getByRole("button", { name: labels.chat.send, exact: true }).click();
      await requestReady;
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
      const input = page.locator('[data-ui="extension-package-input"]'),
        consumer = consumerPackage();
      await input.setInputFiles({
        name: "consumer.cachx",
        mimeType: "application/zip",
        buffer: consumer.buffer,
      });
      const review = page.locator('[data-ui="extension-install-review"]');
      await expect(review).toContainText("fixture.provider");
      await expect(page.locator('[data-ui="extension-confirm-install"]')).toBeDisabled();
      await expect(page.locator('[data-extension-id="fixture.consumer"]')).toHaveCount(0);
      await input.setInputFiles({
        name: "provider.cachx",
        mimeType: "application/zip",
        buffer: providerPackage().buffer,
      });
      await expect(page.locator('[data-ui="extension-confirm-install"]')).toBeEnabled();
      await page.screenshot({ path: `test-results/extensions/install-review-${language}.png` });
      await page.locator('[data-ui="extension-confirm-install"]').click();
      const consumerCard = page.locator('[data-extension-id="fixture.consumer"]');
      await expect(consumerCard).toContainText(labels.extensions.status.active, { timeout: 25000 });
      await expect(page.locator('[data-extension-id="fixture.provider"]')).toContainText(
        labels.extensions.status.active,
      );
      await expect(page.locator("[data-extension-runtime]")).toHaveCount(2);
      await page.getByRole("button", { name: labels.extensions.restartAll, exact: true }).click();
      await expect(consumerCard).toContainText(labels.extensions.status.active, { timeout: 25000 });
      expect(deactivations.length).toBeGreaterThan(0);
      release();
      await page.getByRole("button", { name: labels.settings.close, exact: true }).click();
      await expect(page.getByText("Core stream survived", { exact: true })).toBeVisible();
      await expect(page.getByRole("treeitem")).toContainText("Provider 0.1.0");
      await expect(page.locator('[data-ui="extension-statusbar"]')).toContainText(
        "Installed 2 / Provider 0.1.0",
      );
      const frame = page
        .locator('[data-ui="extension-dock"][data-location="panel"]')
        .frameLocator("iframe");
      await frame.getByRole("button", { name: "Ping host" }).click();
      await expect(frame.locator("#result")).toHaveText("Package asset / Provider 0.1.0");
      await frame.getByRole("button", { name: "Use model" }).click();
      await expect(frame.locator("#result")).toHaveText("Core stream survived");
      expect(
        await page.evaluate(
          () => (window as any).readerBefore === document.querySelector('[data-ui="pdf-page"]'),
        ),
      ).toBe(true);
      expect(failedCore).toEqual([]);
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
      await input.setInputFiles({
        name: "provider-update.cachx",
        mimeType: "application/zip",
        buffer: providerPackage("0.2.0").buffer,
      });
      await expect(review).toContainText("fixture.consumer");
      await page.locator('[data-ui="extension-confirm-install"]').click();
      await expect(consumerCard).toContainText(labels.extensions.status.active, { timeout: 25000 });
      await consumerCard
        .getByRole("button", { name: labels.extensions.restart, exact: true })
        .click();
      await expect(consumerCard).toContainText(labels.extensions.status.active, { timeout: 25000 });
      await page.getByRole("button", { name: labels.settings.close, exact: true }).click();
      await expect(page.locator('[data-ui="extension-statusbar"]')).toContainText(
        "Installed 4 / Provider 0.2.0",
      );
      expect(
        await page.evaluate(
          () =>
            (window as any).readerBefore === document.querySelector('[data-ui="pdf-page"]') &&
            (window as any).navigationBefore === performance.timeOrigin,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
      await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
      const providerCard = page.locator('[data-extension-id="fixture.provider"]');
      await providerCard
        .getByRole("button", { name: labels.extensions.disable, exact: true })
        .click();
      await expect(page.locator('[data-ui="extension-impact-review"]')).toContainText(
        "fixture.consumer",
      );
      await page.getByRole("button", { name: labels.extensions.apply, exact: true }).click();
      await expect(consumerCard).toContainText(labels.extensions.status.disabled);
      await consumerCard
        .getByRole("button", { name: labels.extensions.enable, exact: true })
        .click();
      await expect(providerCard).toContainText(labels.extensions.status.active);
      await providerCard
        .getByRole("button", { name: labels.extensions.uninstall, exact: true })
        .click();
      await page.getByRole("button", { name: labels.extensions.apply, exact: true }).click();
      await expect(consumerCard).toHaveCount(0);
      await expect(providerCard).toHaveCount(0);
      await expect(
        page.locator('[data-extension-id="cachalot.selection-translation"]'),
      ).toContainText(labels.extensions.status.active);
      expect(errors).toEqual([]);
    } finally {
      release();
      await context.close();
      await browser.close();
    }
  });
}

test("installed event listeners receive each change once and unsubscribe independently", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
  const context = await browser.newContext(),
    page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("/");
    await page.getByRole("button", { name: zh.common.settings, exact: true }).click();
    await page.getByRole("button", { name: zh.extensions.title, exact: true }).click();
    await page.locator('[data-ui="extension-package-input"]').setInputFiles({
      name: "events.cachx",
      mimeType: "application/zip",
      buffer: eventPackage().buffer,
    });
    await page.locator('[data-ui="extension-confirm-install"]').click();
    await expect(page.locator('[data-extension-id="fixture.events"]')).toContainText(
      zh.extensions.status.active,
    );
    await page.evaluate(async () => {
      const runtimeUrl =
        performance
          .getEntriesByType("resource")
          .find(
            (entry) => new URL(entry.name).pathname === "/src/application/extensions/runtime.ts",
          )?.name || "/src/application/extensions/runtime.ts";
      const { extensionHost } = await import(/* @vite-ignore */ runtimeUrl);
      // The trusted harness only observes the installed worker's public dependency API.
      await extensionHost.install({
        manifest: {
          publisher: "probe",
          name: "events",
          version: "0.1.0",
          displayName: "Probe",
          description: "Fixture",
          engines: { cachalot: "^0.1.0" },
          activationEvents: ["onStartupFinished"],
          capabilities: [],
          extensionDependencies: ["fixture.events"],
        },
        builtIn: false,
        load: async () => ({
          activate(ctx: any) {
            (window as any).eventFixture = ctx.extensions.getExtension("fixture.events").exports;
          },
        }),
      });
    });
    await page.getByRole("button", { name: zh.settings.general, exact: true }).click();
    await page.locator("#ui-language").selectOption("en");
    await expect
      .poll(() => page.evaluate(() => (window as any).eventFixture.counts()))
      .toEqual({ first: 1, second: 1, language: "en" });
    await page.evaluate(() => (window as any).eventFixture.detachFirst());
    await page.locator("#ui-language").selectOption("zh");
    await expect
      .poll(() => page.evaluate(() => (window as any).eventFixture.counts()))
      .toEqual({ first: 1, second: 2, language: "zh" });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await browser.close();
  }
});

test("installed worker isolation, persistent packages, circular dependency review and stuck-worker recovery", async () => {
  test.setTimeout(90000);
  const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM }),
    context = await browser.newContext(),
    page = await context.newPage();
  try {
    await page.goto("/");
    const open = async () => {
      await page.getByRole("button", { name: zh.common.settings, exact: true }).click();
      await page.getByRole("button", { name: zh.extensions.title, exact: true }).click();
    };
    await open();
    const input = page.locator('[data-ui="extension-package-input"]');
    await input.setInputFiles([
      { name: "provider.cachx", mimeType: "application/zip", buffer: providerPackage().buffer },
      { name: "consumer.cachx", mimeType: "application/zip", buffer: consumerPackage().buffer },
    ]);
    await page.locator('[data-ui="extension-confirm-install"]').click();
    await expect(page.locator('[data-extension-id="fixture.consumer"]')).toContainText(
      zh.extensions.status.active,
      { timeout: 25000 },
    );
    const isolation = await page.evaluate(async () => {
      const runtimeUrl =
        performance
          .getEntriesByType("resource")
          .find(
            (entry) => new URL(entry.name).pathname === "/src/application/extensions/runtime.ts",
          )?.name || "/src/application/extensions/runtime.ts";
      const { extensionHost } = await import(/* @vite-ignore */ runtimeUrl);
      // Inspect through a trusted harness command, exercising the same isolated exported API.
      let result: unknown;
      await extensionHost.install({
        manifest: {
          publisher: "probe",
          name: "isolation",
          version: "0.1.0",
          displayName: "Probe",
          description: "Fixture",
          engines: { cachalot: "^0.1.0" },
          activationEvents: ["onStartupFinished"],
          capabilities: [],
          extensionDependencies: ["fixture.consumer"],
        },
        builtIn: false,
        load: async () => ({
          async activate(ctx: any) {
            result = await ctx.extensions.getExtension("fixture.consumer").exports.isolation();
          },
        }),
      });
      return result;
    });
    expect(isolation).toEqual({
      document: "undefined",
      tauri: "undefined",
      storage: "blocked",
      network: "blocked",
    });
    await page.reload();
    await open();
    await expect(page.locator('[data-extension-id="fixture.consumer"]')).toContainText(
      zh.extensions.status.active,
      { timeout: 25000 },
    );
    await input.setInputFiles({
      name: "stuck.cachx",
      mimeType: "application/zip",
      buffer: stuckPackage().buffer,
    });
    await page.locator('[data-ui="extension-confirm-install"]').click();
    await expect(page.locator('[data-extension-id="fixture.stuck"]')).toContainText(
      zh.extensions.status.active,
    );
    await page.evaluate(async () => {
      const runtimeUrl =
        performance
          .getEntriesByType("resource")
          .find(
            (entry) => new URL(entry.name).pathname === "/src/application/extensions/runtime.ts",
          )?.name || "/src/application/extensions/runtime.ts";
      const { extensionHost } = await import(/* @vite-ignore */ runtimeUrl);
      void extensionHost.executeCommand("fixture.stuck.spin").catch(() => undefined);
    });
    await expect(page.locator('[data-extension-id="fixture.stuck"]')).toContainText(
      zh.extensions.status.error,
      { timeout: 15000 },
    );
    await expect(page.locator('[data-extension-id="fixture.consumer"]')).toContainText(
      zh.extensions.status.active,
    );
    await page.getByRole("button", { name: zh.extensions.restartAll, exact: true }).click();
    await expect(page.locator('[data-extension-id="fixture.consumer"]')).toContainText(
      zh.extensions.status.active,
    );
    await expect(page.locator('[data-extension-id="fixture.stuck"]')).toContainText(
      zh.extensions.status.active,
    );
    const malformed = {
      ...stuckPackage().manifest,
      name: "malformed",
      displayName: "Malformed fixture",
      contributes: {},
    };
    await input.setInputFiles({
      name: "malformed.cachx",
      mimeType: "application/zip",
      buffer: extensionArchive(
        malformed,
        'export function activate(ctx) { const item=ctx.window.createStatusBarItem("fixture.malformed.status"); item.text={zh:{bad:true},en:"Bad"}; item.show(); }',
      ),
    });
    await page.locator('[data-ui="extension-confirm-install"]').click();
    await expect(page.locator('[data-extension-id="fixture.malformed"]')).toContainText(
      zh.extensions.status.error,
    );
    await expect(page.locator('[data-extension-id="fixture.consumer"]')).toContainText(
      zh.extensions.status.active,
    );
    await input.setInputFiles([
      { name: "v1.cachx", mimeType: "application/zip", buffer: providerPackage().buffer },
      { name: "v2.cachx", mimeType: "application/zip", buffer: providerPackage("0.2.0").buffer },
    ]);
    await expect(
      page.getByRole("alert").filter({ hasText: zh.extensions.duplicatePackageVersions }),
    ).toBeVisible();
    await expect(page.locator('[data-extension-id="fixture.consumer"]')).toContainText(
      zh.extensions.status.active,
    );
    const a = {
        ...stuckPackage().manifest,
        name: "cycle-a",
        contributes: {},
        extensionDependencies: ["fixture.cycle-b"],
      },
      b = { ...a, name: "cycle-b", extensionDependencies: ["fixture.cycle-a"] };
    await input.setInputFiles([
      {
        name: "a.cachx",
        mimeType: "application/zip",
        buffer: extensionArchive(a, "export function activate() {}"),
      },
      {
        name: "b.cachx",
        mimeType: "application/zip",
        buffer: extensionArchive(b, "export function activate() {}"),
      },
    ]);
    await expect(page.locator('[data-ui="extension-confirm-install"]')).toBeDisabled();
    await expect(page.locator('[data-ui="extension-install-review"]')).toContainText("循环依赖");
    await expect(page.locator('[data-extension-id="fixture.cycle-a"]')).toHaveCount(0);
  } finally {
    await context.close();
    await browser.close();
  }
});

for (const language of ["zh", "en"] as const) {
  test(
    "installed Worker uses shared commands, typed settings and scoped interactions (" +
      language +
      ")",
    async () => {
      test.setTimeout(90000);
      const labels = language === "en" ? en : zh;
      const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(),
        errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.addInitScript((language) => {
          if (window.top === window) localStorage.setItem("cachalot:setting:uiLanguage", language);
        }, language);
        await page.goto("/");
        await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
          name: "workbench.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(cacheFixture.pdfBytes),
        });
        await expect(page.locator('[data-ui="pdf-page"]')).toHaveAttribute("data-rendered", "true");
        await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
        await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
        await page.locator('[data-ui="extension-package-input"]').setInputFiles({
          name: "workbench.cachx",
          mimeType: "application/zip",
          buffer: workbenchPackage().buffer,
        });
        await page.locator('[data-ui="extension-confirm-install"]').click();
        const card = page.locator('[data-extension-id="fixture.workbench"]');
        await expect(card).toContainText(labels.extensions.status.active, { timeout: 25000 });
        const checkbox = card.getByRole("checkbox", {
          name: language === "en" ? "Enable interaction" : "启用交互",
        });
        await checkbox.uncheck();
        await card
          .locator('[data-ui="extension-configuration"]')
          .getByRole("button", { name: labels.workbench.save, exact: true })
          .first()
          .click();
        await expect(page.locator('[data-ui="extension-statusbar"]')).toContainText("Config=false");
        await page.getByRole("button", { name: labels.common.backLibrary, exact: true }).click();
        const run = page.getByRole("button", {
          name: language === "en" ? "Plugin interaction" : "插件交互",
          exact: true,
        });
        await expect(run).toBeDisabled();
        await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
        await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
        await checkbox.check();
        await card
          .locator('[data-ui="extension-configuration"]')
          .getByRole("button", { name: labels.workbench.save, exact: true })
          .first()
          .click();
        await page.getByRole("button", { name: labels.common.backLibrary, exact: true }).click();
        await expect(run).toBeEnabled();
        await expect(page.locator('[data-ui="extension-statusbar"]')).toContainText(
          "page=1;zoom=1",
        );
        await page.keyboard.press("Control+Shift+P");
        const palette = page.getByRole("dialog", { name: labels.workbench.commands, exact: true });
        await palette.getByRole("textbox", { name: labels.workbench.search }).fill("Context ping");
        await palette.getByRole("option", { name: /Context ping/ }).click();
        await expect(
          page.getByRole("status").filter({ hasText: "Context command ran" }),
        ).toBeVisible();
        await page
          .getByRole("status")
          .filter({ hasText: "Context command ran" })
          .getByRole("button")
          .click();
        await page.keyboard.press("Control+Alt+b");
        await expect(
          page.getByRole("status").filter({ hasText: "Context command ran" }),
        ).toBeVisible();
        await run.click();
        await page
          .getByRole("dialog", { name: "Pick fixture" })
          .getByRole("option", { name: "Second item" })
          .click();
        const input = page.getByRole("dialog", { name: "Name fixture" });
        await input.getByRole("textbox").fill("Worker round trip");
        await input.getByRole("button", { name: labels.workbench.submit }).click();
        await expect(
          page.getByRole("status").filter({ hasText: "Completed Worker round trip" }),
        ).toBeVisible();
        await run.click();
        await expect(page.getByRole("dialog", { name: "Pick fixture" })).toBeVisible();
        // Stop through the production host while its input request is outstanding.
        await page.evaluate(async () => {
          const runtimeUrl =
            performance
              .getEntriesByType("resource")
              .find(
                (entry) =>
                  new URL(entry.name).pathname === "/src/application/extensions/runtime.ts",
              )?.name || "/src/application/extensions/runtime.ts";
          const { extensionHost } = await import(/* @vite-ignore */ runtimeUrl);
          await extensionHost.setEnabled("fixture.workbench", false);
        });
        await expect(page.getByRole("dialog", { name: "Pick fixture" })).toHaveCount(0);
        await expect(run).toHaveCount(0);
        await expect(page.locator('[data-ui="pdf-page"]')).toHaveAttribute("data-rendered", "true");
        await expect(page.locator("[data-extension-runtime]")).toHaveCount(0);
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await browser.close();
      }
    },
  );
}

for (const language of ["zh", "en"] as const) {
  test(
    "public SDK bookmark example installs, navigates and retains saved state (" + language + ")",
    async ({}, testInfo) => {
      const temporary = await mkdtemp(join(tmpdir(), "cachalot-bookmarks-"));
      const browser = await chromium.launch({ executablePath: process.env.CACHALOT_CHROMIUM });
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(),
        labels = language === "en" ? en : zh;
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        const archive = await packageExtension(
          "examples/bookmarks",
          join(temporary, "bookmarks.cachx"),
        );
        await page.addInitScript((language) => {
          if (window.top === window) localStorage.setItem("cachalot:setting:uiLanguage", language);
        }, language);
        await page.goto("/");
        await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles({
          name: "bookmarks.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from(cacheFixturePdf(2)),
        });
        await expect(page.locator('[data-ui="pdf-page"][data-page="1"]')).toHaveAttribute(
          "data-rendered",
          "true",
        );
        await page.getByRole("button", { name: labels.common.settings, exact: true }).click();
        await page.getByRole("button", { name: labels.extensions.title, exact: true }).click();
        await page.locator('[data-ui="extension-package-input"]').setInputFiles({
          name: "bookmarks.cachx",
          mimeType: "application/zip",
          buffer: await readFile(archive),
        });
        await page.locator('[data-ui="extension-confirm-install"]').click();
        await expect(page.locator('[data-extension-id="example.bookmarks"]')).toContainText(
          labels.extensions.status.active,
        );
        await page.getByRole("button", { name: labels.common.backLibrary, exact: true }).click();
        const add = language === "en" ? "Add Reading Bookmark" : "添加阅读书签";
        const name = language === "en" ? "Bookmark name" : "书签名称";
        await page.locator('[data-ui="pdf-page"][data-page="1"]').click({ button: "right" });
        await page.getByRole("menuitem", { name: add, exact: true }).click();
        const input = page.getByRole("dialog", { name, exact: true });
        await expect(input.getByRole("textbox")).toHaveValue(
          language === "en" ? "Page 1" : "第 1 页",
        );
        await input.getByRole("textbox").fill("Methods bookmark");
        await input.getByRole("button", { name: labels.workbench.submit, exact: true }).click();
        const bookmark = page.getByRole("treeitem").filter({ hasText: "Methods bookmark" });
        await expect(bookmark).toBeVisible();
        // A view-title menu uses the view.id condition, independently of the reader toolbar.
        await page
          .locator('[data-ui="extension-dock"]')
          .getByRole("button", { name: add, exact: true })
          .click();
        await expect(input).toBeVisible();
        await input.getByRole("button", { name: labels.workbench.cancel, exact: true }).click();
        await expect(page.getByRole("treeitem")).toHaveCount(1);
        const jump = page.getByRole("textbox", { name: labels.reader.jumpToPage, exact: true });
        await jump.fill("2");
        await jump.press("Enter");
        await expect(
          page.locator('[data-ui="page-thumbnail"]').filter({ hasText: /^2$/ }),
        ).toHaveAttribute("aria-pressed", "true");
        await bookmark.getByRole("button").click();
        await expect(
          page.locator('[data-ui="page-thumbnail"]').filter({ hasText: /^1$/ }),
        ).toHaveAttribute("aria-pressed", "true");
        await page.reload();
        await page.locator('[data-ui="document-card"]').click();
        await page.getByTitle(language === "en" ? "Bookmarks" : "书签", { exact: true }).click();
        await expect(page.locator('[data-ui="pdf-page"][data-page="1"]')).toHaveAttribute(
          "data-rendered",
          "true",
        );
        await expect(bookmark).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("bookmarks-" + language + ".png") });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
        await browser.close();
        await rm(temporary, { recursive: true, force: true });
      }
    },
  );
}
