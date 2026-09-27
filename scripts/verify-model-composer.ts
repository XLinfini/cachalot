/** Exercise the actual composer and request adapter with isolated fixtures. */
import assert from "node:assert/strict";
import { expect, type Page, type Request } from "@playwright/test";
import type { LocaleResource } from "../src/i18n/locales/en";

export async function verifyModelComposer(
  page: Page,
  labels: LocaleResource,
  output: string,
  width: number,
) {
  const requests: Array<{ path: string; body: { model: string; messages: unknown[] } }> = [];
  const capture = (request: Request) => {
    if (request.url().endsWith("/chat/completions"))
      requests.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  };
  page.on("request", capture);
  const picker = page.getByRole("button", { name: labels.chat.chooseModel, exact: true });
  const upload = page.getByRole("button", { name: labels.chat.uploadImage, exact: true });
  const send = page.getByRole("button", { name: labels.chat.send, exact: true });
  const input = page.getByPlaceholder(labels.chat.placeholder, { exact: true });
  const menu = page.locator('[data-ui="model-menu"]');
  const choose = async (providerName: string, modelId: string) => {
    await picker.click();
    const group = menu.getByRole("button", { name: providerName, exact: true });
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    await menu.getByRole("button", { name: modelId, exact: true }).click();
    await expect(picker).toContainText(modelId);
  };
  const ask = async (question: string) => {
    const before = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("cachalot:messages") || "[]").filter(
          (message: { role: string }) => message.role === "assistant",
        ).length,
    );
    const count = requests.length;
    await input.fill(question);
    await send.click();
    await page.waitForFunction(
      (before) =>
        JSON.parse(localStorage.getItem("cachalot:messages") || "[]").filter(
          (message: { role: string }) => message.role === "assistant",
        ).length > before,
      before,
    );
    assert.equal(requests.length, count + 1);
    return requests.at(-1)!;
  };
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 140;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#e9f1fb";
    context.fillRect(0, 0, 240, 140);
    context.strokeStyle = "#2e70cc";
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(15, 120);
    context.lineTo(65, 90);
    context.lineTo(110, 105);
    context.lineTo(160, 30);
    context.lineTo(220, 15);
    context.stroke();
    return canvas.toDataURL("image/png");
  });
  const image = {
    name: "figure.png",
    mimeType: "image/png",
    buffer: Buffer.from(imageData.split(",")[1], "base64"),
  };
  const attach = async () => {
    await page.locator('[data-ui="chat-image-input"]').setInputFiles(image);
    await page.locator('[data-ui="draft-image"]').waitFor();
  };
  try {
    assert.equal(
      await page.locator('[data-ui="model-picker"]').count(),
      1,
      "only the composer contains the model selector",
    );
    assert.equal(await upload.isDisabled(), true);
    await upload.hover({ force: true });
    await page
      .getByRole("tooltip")
      .getByText(labels.messages.imageUnsupported, { exact: true })
      .waitFor();
    const pickerBounds = await picker.boundingBox(),
      sendBounds = await send.boundingBox();
    assert.ok(
      pickerBounds &&
        sendBounds &&
        pickerBounds.x < sendBounds.x &&
        Math.abs(pickerBounds.y - sendBounds.y) < 8,
    );
    await picker.click();
    const menuBounds = await menu.boundingBox();
    assert.ok(
      menuBounds && menuBounds.y > 0 && menuBounds.y + menuBounds.height <= pickerBounds.y,
      "model menu opens upward",
    );
    await menu.getByRole("button", { name: "本地样式测试", exact: true }).click();
    await menu.getByRole("button", { name: "test-vision-model", exact: true }).waitFor();
    await page.screenshot({ path: `${output}/model-menu-${width}.png` });
    await menu.getByRole("button", { name: "test-vision-model", exact: true }).click();
    await expect(upload).toBeEnabled();
    await attach();
    await page.screenshot({ path: `${output}/image-draft-${width}.png` });
    const first = await ask("Explain this uploaded image.");
    assert.equal(
      first.body.model,
      "test-vision-model",
      "selected model overrides provider default",
    );
    assert.ok(JSON.stringify(first.body.messages).includes(imageData));
    await page.locator('[data-ui="message-image"]').waitFor();
    const metadata = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("cachalot:messages") || "[]").find(
        (message: { content: string }) => message.content === "Explain this uploaded image.",
      ),
    );
    assert.equal(
      metadata.images[0].dataUrl,
      "",
      "browser localStorage holds metadata, not large image payloads",
    );
    const stored = (await page.evaluate(async (id: string) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("cachalot-chat-images", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction("images").objectStore("images").get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    }, metadata.id)) as Array<{ dataUrl: string }>;
    assert.equal(stored[0].dataUrl, imageData);

    await choose("本地样式测试", "test-academic-model");
    await expect(upload).toBeDisabled();
    const text = await ask("Continue using the previous answer.");
    assert.equal(text.body.model, "test-academic-model");
    assert.ok(
      !JSON.stringify(text.body.messages).includes("image_url") &&
        !JSON.stringify(text.body.messages).includes("data:image/"),
      "historical images must not be sent to a text-only model",
    );
    assert.equal(
      await page.locator('[data-ui="message-image"]').count(),
      1,
      "switching models preserves the original historical image",
    );

    await choose("本地样式测试", "test-vision-model");
    await expect(upload).toBeEnabled();
    const again = await ask("Use the original image again.");
    assert.ok(
      JSON.stringify(again.body.messages).includes(imageData),
      "switching back restores images in request context",
    );
    await attach();
    await choose("本地样式测试", "test-academic-model");
    await expect(upload).toBeDisabled();
    await expect(send).toBeDisabled();
    await page.getByText(labels.chat.incompatibleDraft, { exact: true }).waitFor();
    const before = requests.length;
    await input.fill("Draft question with an incompatible image.");
    await input.press("Enter");
    await page.evaluate(async () => {
      for (let frame = 0; frame < 3; frame++)
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    assert.equal(requests.length, before);
    assert.equal(
      await page.locator('[data-ui="draft-image"]').count(),
      1,
      "unsupported-model Enter keeps the image draft",
    );
    assert.equal(await input.inputValue(), "Draft question with an incompatible image.");
    await page
      .getByRole("button", {
        name: labels.chat.removeImage.replace("{{name}}", "figure.png"),
        exact: true,
      })
      .click();
    const withoutDraft = await ask("Send this question after removing the incompatible image.");
    assert.ok(!JSON.stringify(withoutDraft.body.messages).includes("image_url"));

    await choose("另一个提供商", "other-model");
    const second = await ask("Check the other provider.");
    assert.equal(second.path, "/second/v1/chat/completions");
    assert.equal(second.body.model, "other-model");
    await page.reload();
    await page.locator('[data-ui="document-card"]').first().click();
    await expect(picker).toContainText("other-model");
    await page.locator('[data-ui="message-image"]').waitFor();
    const reopened = await ask("Continue after reopening with the text-only model.");
    assert.ok(!JSON.stringify(reopened.body.messages).includes("image_url"));
    await page.screenshot({ path: `${output}/image-history-${width}.png` });
    await choose("本地样式测试", "test-academic-model");
    await expect(upload).toBeDisabled();
  } finally {
    page.off("request", capture);
  }
}
