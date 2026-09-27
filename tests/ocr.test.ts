import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import {
  formulaLatex,
  glmFormulaLatex,
  glmOcrEndpoint,
  validateOcrImage,
  GLM_OCR_MODEL,
} from "../src/domain/ocr";
import { chatModels, normalizeModels, ocrModels } from "../src/domain/provider-models";
import { platform } from "../src/infrastructure/platform";
import {
  listConfiguredProviders,
  listModels,
  saveConfiguredProvider,
} from "../src/application/model-catalog";
import {
  getOcrSelection,
  saveOcrSelection,
  selectedOcrModel,
} from "../src/application/ocr-settings";
import { parseMessage } from "../src/domain/messages";
import { recognizeFormula } from "../src/infrastructure/ocr/formula-ocr";

test("GLM endpoint preview shares native fixtures and accepts bare origins and pasted endpoints", () => {
  const fixtures = JSON.parse(readFileSync("tests/fixtures/ocr-endpoints.json", "utf8"));
  for (const { baseUrl, endpoint } of fixtures) assert.equal(glmOcrEndpoint(baseUrl), endpoint);
  for (const value of ["", "example.com", "ftp://example.com"])
    assert.throws(() => glmOcrEndpoint(value));
});
test("OCR normalization preserves a single formula without merging ambiguous blocks", () => {
  const latex = "x^2+\\frac{1}{y}=0";
  for (const text of [latex, `$$${latex}$$`, `\\[${latex}\\]`, "```latex\n" + latex + "\n```"])
    assert.equal(formulaLatex(text), latex);
  assert.equal(
    glmFormulaLatex({
      layout_details: [
        [
          { label: "text", content: "(4)" },
          { label: "formula", content: `$$${latex}$$` },
        ],
      ],
      md_results: "ignored",
    }),
    latex,
  );
  assert.equal(glmFormulaLatex({ md_results: `$$${latex}$$` }), latex);
  assert.equal(
    glmFormulaLatex({
      layout_details: [
        [
          { label: "formula", content: "x" },
          { label: "formula", content: "y" },
        ],
      ],
    }),
    null,
  );
  assert.equal(glmFormulaLatex({ md_results: "$$x$$\n$$y$$" }), null);
  assert.equal(glmFormulaLatex({ md_results: "# heading\n$$x$$" }), null);
  assert.equal(glmFormulaLatex({ error: "failure" }), null);
  assert.equal(glmFormulaLatex({ md_results: "Recognition failed" }), null);
  assert.throws(() => validateOcrImage("https://example.com/paper.png"));
});
test("OCR provider/model settings are shared, independently selected and safely transported", async () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const secret = "fixture-private-key-1234";
  let calls = 0;
  let answer = Response.json({ layout_details: [[{ label: "formula", content: "$$x^2+1=0$$" }]] });
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://ocr.invalid/api/paas/v4/layout_parsing");
    assert.equal(options?.method, "POST");
    assert.equal((options?.headers as Record<string, string>).Authorization, `Bearer ${secret}`);
    assert.deepEqual(JSON.parse(options?.body as string), {
      model: "glm-ocr",
      file: "data:image/png;base64,AAAA",
      return_crop_images: false,
      need_layout_visualization: false,
    });
    return answer;
  };
  try {
    const provider = await saveConfiguredProvider({
      id: "ocr-fixture",
      name: "OCR fixture",
      baseUrl: "https://ocr.invalid",
      modelId: "glm-ocr",
      enabled: true,
      apiKey: secret,
      addedModels: [
        GLM_OCR_MODEL,
        { id: "translate" },
        { id: "vision", formulaOcr: "vision-llm" },
        { id: "paddle", formulaOcr: "formula-chat" },
      ],
    });
    assert.deepEqual(
      chatModels(provider).map((m) => m.id),
      ["translate", "vision"],
    );
    assert.deepEqual(
      ocrModels(provider).map((m) => m.id),
      ["glm-ocr", "vision", "paddle"],
    );
    assert.deepEqual((await listConfiguredProviders())[0].addedModels, provider.addedModels);
    assert.deepEqual(await listModels(provider.id), [GLM_OCR_MODEL]);
    assert.equal(calls, 0, "GLM fixed model catalogue must not call /models");
    await platform.setSetting(
      "activeModel",
      JSON.stringify({ providerId: provider.id, modelId: "translate" }),
    );
    await saveOcrSelection({ providerId: provider.id, modelId: "glm-ocr" });
    assert.deepEqual(await getOcrSelection(), { providerId: provider.id, modelId: "glm-ocr" });
    assert.equal(
      (await selectedOcrModel({ providerId: provider.id, modelId: "glm-ocr" })).protocol,
      "glm-layout",
    );
    assert.equal(JSON.parse((await platform.getSetting("activeModel"))!).modelId, "translate");
    assert.deepEqual(
      await platform.glmOcr({
        providerId: provider.id,
        modelId: "glm-ocr",
        imageDataUrl: "data:image/png;base64,AAAA",
      }),
      { layout_details: [[{ label: "formula", content: "$$x^2+1=0$$" }]] },
    );
    for (const status of [503, 200]) {
      answer = Response.json(
        { error: { message: `denied ${secret}` } },
        { status, headers: { "x-request-id": "ocr-diagnostic" } },
      );
      await assert.rejects(
        () =>
          platform.glmOcr({
            providerId: provider.id,
            modelId: "glm-ocr",
            imageDataUrl: "data:image/png;base64,AAAA",
          }),
        (error: unknown) => {
          const text = String(error);
          assert(!text.includes(secret));
          assert(text.includes("denied"));
          assert(text.includes("ocr-diagnostic"));
          assert.equal(
            parseMessage(text)?.code,
            status === 503 ? "ocrHttpDetails" : "ocrResponseError",
          );
          return true;
        },
      );
    }
    answer = Response.json({ code: 1301, message: "rate limited" });
    await assert.rejects(() =>
      platform.glmOcr({
        providerId: provider.id,
        modelId: "glm-ocr",
        imageDataUrl: "data:image/png;base64,AAAA",
      }),
    );
    await saveConfiguredProvider({ ...provider, enabled: false });
    await assert.rejects(() => selectedOcrModel({ providerId: provider.id, modelId: "glm-ocr" }));
    assert.equal(calls, 4, "Invalid OCR selection cannot trigger a fallback request");
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://ocr.invalid/v1/chat/completions");
      const input = JSON.parse(options?.body as string);
      assert.equal(input.model, "paddle");
      assert.deepEqual(input.messages, [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
            { type: "text", text: "Formula Recognition:" },
          ],
        },
      ]);
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "$$x^2+1=0$$" } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      );
    };
    await saveConfiguredProvider({ ...provider, enabled: true });
    assert.equal(
      await recognizeFormula(
        "formula-chat",
        { ...provider, modelId: "paddle" },
        { imageDataUrl: "data:image/png;base64,AAAA" },
      ),
      "x^2+1=0",
    );
    assert.equal(await platform.revealProviderKey(provider.id), secret);
    await saveOcrSelection("off");
    assert.equal(await getOcrSelection(), "off");
    await saveOcrSelection(null);
    assert.equal(await getOcrSelection(), null);
    await platform.setSetting("formulaOcrModel", "invalid");
    await assert.rejects(getOcrSelection);
    assert.deepEqual(
      normalizeModels([
        { id: "x", formulaOcr: "invalid" },
        { id: "glm", formulaOcr: "glm-layout" },
      ]),
      [{ id: "x" }, { id: "glm", formulaOcr: "glm-layout" }],
    );
  } finally {
    await platform.deleteProvider("ocr-fixture");
    globalThis.fetch = previousFetch;
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
