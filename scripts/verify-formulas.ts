import assert from "node:assert/strict";
import { expect, type Page, type Request, type Route } from "@playwright/test";
import type { LocaleResource } from "../src/i18n/locales/en";

/** Real selection -> persistent source assets -> model input -> LaTeX reflow. */
export async function verifyFormulas(page: Page, labels: LocaleResource, output: string) {
  const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const capture = (request: Request) => {
    if (request.url().endsWith("/chat/completions")) requests.push(request.postDataJSON());
  };
  page.on("request", capture);
  const choose = async (model: string) => {
    await page.getByRole("button", { name: labels.chat.chooseModel, exact: true }).click();
    const menu = page.locator('[data-ui="model-menu"]');
    const group = menu.getByRole("button", { name: "本地样式测试", exact: true });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    await menu.getByRole("button", { name: model, exact: true }).click();
  };
  const open = async () => {
    await page.getByRole("button", { name: labels.reader.translate }).click();
    await expect(
      page.getByRole("button", { name: labels.translation.copy, exact: true }),
    ).toBeEnabled();
  };
  const ocrCount = () =>
    requests.filter((r) => String(r.messages[0].content).startsWith("仅转写")).length;
  try {
    await page.getByTitle(labels.reader.page.replace("{{page}}", "2"), { exact: true }).click();
    const host = page.locator('[data-ui="pdf-page"][data-page="2"][data-rendered="true"]');
    await host.waitFor();
    await page.waitForFunction(() => {
      const top = document
        .querySelector('[data-ui="pdf-page"][data-page="2"]')
        ?.getBoundingClientRect().top;
      return top !== undefined && top > 100 && top < 250;
    });
    await page.getByRole("button", { name: labels.reader.region, exact: true }).click();
    const bounds = (await host.boundingBox())!;
    await page.mouse.move(bounds.x + 0.509 * bounds.width, bounds.y + 0.25 * bounds.height);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 0.936 * bounds.width, bounds.y + 0.373 * bounds.height, {
      steps: 6,
    });
    await page.mouse.up();
    await open();
    const result = page.locator('[data-ui="translation-result"]');
    const images = result.locator('[data-ui="preserved-formula"][data-mode="display"]');
    assert.ok(
      (await result.locator(".katex").count()) >= 3,
      "native inline variables use LaTeX in the translation",
    );
    await expect(images).toHaveCount(1);
    await expect(images).toHaveAttribute("data-mode", "display");
    const sourceAssets = await images.evaluateAll((nodes) =>
      nodes.map((node) => ({
        id: node.getAttribute("data-formula-id"),
        src: (node as HTMLImageElement).src,
        width: (node as HTMLImageElement).naturalWidth,
      })),
    );
    assert.ok(sourceAssets.every((a) => a.src.startsWith("data:image/png;") && a.width > 0));
    const textRequest = JSON.stringify(requests.at(-1));
    assert.match(textRequest, /I_\{op\}/);
    assert.ok(
      !textRequest.includes('"type":"image_url"'),
      "text models receive candidates and anchors, no image payloads",
    );
    assert.equal(ocrCount(), 0);
    await page.screenshot({ path: `${output}/formulas-text.png` });
    await page.getByRole("button", { name: labels.translation.close }).click();

    await choose("test-vision-model");
    await expect(
      page.getByRole("button", { name: labels.chat.uploadImage, exact: true }),
    ).toBeEnabled();
    await open();
    assert.equal(ocrCount(), 1, "only unresolved source formula is transcribed on demand");
    await expect(images).toHaveCount(0);
    await expect(result.locator(".katex-display")).toHaveCount(1);
    const reconstructed = page.locator('[data-ui="translation-reconstructed-source"]');
    assert.deepEqual(
      await result.locator(".katex-display annotation").allTextContents(),
      await reconstructed.locator(".katex-display annotation").allTextContents(),
      "translation uses the exact source reconstruction",
    );
    await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
    await expect(
      page.getByRole("button", { name: labels.translation.copy, exact: true }),
    ).toBeEnabled();
    assert.equal(ocrCount(), 1, "retry reuses persistent recognition cache");
    await page.screenshot({ path: `${output}/formulas-vision.png` });

    // Bad translations must not silently drop equations from the reflow result.
    const badHandler = (route: Route) =>
      route.fulfill({
        contentType: "text/event-stream",
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: "Missing all original equation references." } }] })}\n\ndata: [DONE]\n\n`,
      });
    await page.route("**/v1/chat/completions", badHandler);
    await page.getByRole("button", { name: labels.common.retry, exact: true }).click();
    await page.getByText(labels.messages.formulaReferencesChanged, { exact: true }).waitFor();
    await expect(
      page.getByRole("button", { name: labels.translation.copy, exact: true }),
    ).toBeDisabled();
    await page.unroute("**/v1/chat/completions", badHandler);
    await page.getByRole("button", { name: labels.translation.close }).click();
    await choose("test-academic-model");
    await open();
    assert.equal(ocrCount(), 1);
    const reused = JSON.stringify(requests.at(-1));
    assert.ok(
      reused.includes("\\\\frac"),
      "text models can reuse cached OCR LaTeX without receiving the image",
    );
    assert.ok(!reused.includes('"type":"image_url"'));
    await expect(images).toHaveCount(0);
    await expect(result.locator(".katex-display")).toHaveCount(1);
    await page.getByRole("button", { name: labels.translation.close }).click();
    await page.getByTitle(labels.reader.page.replace("{{page}}", "1"), { exact: true }).click();
  } finally {
    page.off("request", capture);
  }
}
