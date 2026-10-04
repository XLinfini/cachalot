import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import "../support/register-ocr";
import type { OcrAdapter } from "../../src/domain/ocr-adapter";
import { OcrAdapterRegistry, ocrAdapters } from "../../src/infrastructure/ocr/registry";
import { recognizeFormulas } from "../../src/infrastructure/ocr/formula-ocr";
import {
  listOcrAdapters,
  listOcrPresets,
  createOcrPreset,
  ocrRequestEndpoint,
} from "../../src/application/ocr/catalog";
import { saveConfiguredProvider, listModels } from "../../src/application/model-catalog";
import { selectedOcrModel } from "../../src/application/ocr/settings";
import { platform } from "../../src/infrastructure/platform";
import { normalizeModels, providerPurpose } from "../../src/domain/provider-models";
import { parseMessage } from "../../src/domain/messages";

/** This fictional provider has a different endpoint, auth header and result
 * schema. It needs no branch in the application or settings components. */
const extension: OcrAdapter = {
  id: "fixture-vendor",
  label: { zh: "测试厂商", en: "Fixture vendor" },
  batchSize: 1,
  cachePrefix: "fixture-ocr-v1",
  endpoint: (base) => `${new URL(base).origin}/extract-math`,
  presets: [
    {
      id: "fixture-preset",
      name: "Fixture OCR",
      buttonLabel: { zh: "添加测试预设", en: "Add fixture preset" },
      baseUrl: "https://fixture.invalid",
      models: [{ id: "math-v1" }],
    },
  ],
  async listModels() {
    return [{ id: "math-v1" }];
  },
  async recognize(context, inputs) {
    const { body } = await context.transport.json({
      url: this.endpoint(context.baseUrl),
      auth: { type: "header", name: "x-token" },
      headers: { "x-api-version": "2026" },
      body: { engine: context.modelId, crop: inputs[0].imageDataUrl },
    });
    return [{ id: inputs[0].id, latex: (body as { math?: string }).math || null }];
  },
};

test("a third-party adapter supplies UI metadata, presets, models and recognition through the interface", async () => {
  const registry = new OcrAdapterRegistry();
  registry.register(extension);
  assert.throws(() => registry.register(extension), /Duplicate/);
  assert.throws(() => registry.register({ ...extension, id: "invalid_id" }), /Invalid/);
  assert.throws(
    () => registry.register({ ...extension, id: "another-vendor" }),
    /Duplicate OCR preset/,
  );
  ocrAdapters.register(extension);
  assert.equal(
    listOcrAdapters().find((adapter) => adapter.id === extension.id)?.label.en,
    "Fixture vendor",
  );
  assert.equal(
    listOcrPresets().find((preset) => preset.id === "fixture-preset")?.adapterId,
    extension.id,
  );
  const input = createOcrPreset("fixture-preset");
  assert.deepEqual(input.addedModels, [{ id: "math-v1", formulaOcr: "fixture-vendor" }]);
  assert.equal(
    ocrRequestEndpoint(extension.id, input.baseUrl),
    "https://fixture.invalid/extract-math",
  );
  assert.equal(providerPurpose({ modelId: "math-v1", addedModels: input.addedModels }), "ocr");
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage"),
    fetch = globalThis.fetch;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    requests++;
    assert.equal(url, "https://fixture.invalid/extract-math");
    assert.equal((options!.headers as Record<string, string>)["x-token"], "fixture-token-only");
    assert.deepEqual(JSON.parse(String(options!.body)), {
      engine: "math-v1",
      crop: "data:image/png;base64,AAAA",
    });
    return Response.json({ math: "x^2=1", debug: "fixture-token-only" });
  };
  try {
    const provider = await saveConfiguredProvider({ ...input, apiKey: "fixture-token-only" });
    assert.deepEqual(await listModels(provider.id), input.addedModels);
    assert.equal(requests, 0, "The adapter owns its static model list");
    assert.equal(
      (await selectedOcrModel({ providerId: provider.id, modelId: "math-v1" })).protocol,
      extension.id,
    );
    assert.deepEqual(
      await recognizeFormulas(extension.id, provider, [
        { id: "one", imageDataUrl: "data:image/png;base64,AAAA" },
      ]),
      [{ id: "one", latex: "x^2=1" }],
    );
    assert.equal(requests, 1);
    const missing = await saveConfiguredProvider({
      ...provider,
      addedModels: [{ id: "math-v1", formulaOcr: "removed-vendor" }],
    });
    assert.equal(normalizeModels(missing.addedModels)[0].formulaOcr, "removed-vendor");
    await assert.rejects(
      selectedOcrModel({ providerId: provider.id, modelId: "math-v1" }),
      (cause) => parseMessage(String(cause))?.code === "ocrAdapterUnavailable",
    );
    await assert.rejects(listModels(provider.id));
    assert.equal(requests, 1, "Unavailable adapters never make a paid fallback request");
    await platform.deleteProvider(provider.id);
  } finally {
    globalThis.fetch = fetch;
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
