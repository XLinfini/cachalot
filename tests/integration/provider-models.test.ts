import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { platform } from "../../src/infrastructure/platform";
import {
  listConfiguredProviders,
  saveConfiguredProvider,
  listModels,
  supportsImages,
} from "../../src/application/model-catalog";
import {
  addedModels,
  hasAddedModel,
  parseModelSelection,
  isChatSelection,
  resolveDefaultModel,
} from "../../src/domain/provider-models";

test("settings alone define added models; fetching a catalogue never adds or persists models", async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return Response.json({ data: [{ id: "unadded" }, { id: "vision", owned_by: "fixture" }] });
  };
  const input = {
    id: "model-fixture",
    name: "Fixture",
    baseUrl: "https://fixture.invalid",
    modelId: "default",
    enabled: true,
    apiKey: "sk-fixture-only-abcd",
  };
  try {
    await platform.saveProvider(input);
    // Old catalogue caches and chat selections are not migration sources.
    await platform.setSetting(`models:${input.id}`, JSON.stringify([{ id: "unadded" }]));
    await platform.setSetting(
      "activeModel",
      JSON.stringify({ providerId: input.id, modelId: "unadded" }),
    );
    const [legacy] = await listConfiguredProviders();
    assert.deepEqual(legacy.addedModels, [{ id: "default" }]);
    assert.equal(hasAddedModel(legacy, "unadded"), false);
    assert.equal(fetches, 0, "Reading configured models must be offline");

    const beforeFetch = new Map(storage);
    const available = await listModels(input.id);
    assert.deepEqual(
      available.map((model) => model.id),
      ["unadded", "vision"],
    );
    assert.deepEqual(storage, beforeFetch, "Provider catalogue must remain temporary");
    assert.deepEqual((await listConfiguredProviders())[0].addedModels, [{ id: "default" }]);

    const saved = await saveConfiguredProvider({
      ...input,
      apiKey: "",
      addedModels: [{ id: "default" }, { id: "vision", ownedBy: "fixture" }, { id: "vision" }],
    });
    assert.deepEqual(
      saved.addedModels?.map((model) => model.id),
      ["default", "vision"],
    );
    assert.deepEqual((await listConfiguredProviders())[0].addedModels, saved.addedModels);
    assert.equal(
      await platform.revealProviderKey(input.id),
      input.apiKey,
      "Model edits must preserve credentials",
    );

    await platform.setSetting(`vision:${input.id}`, "true");
    const manual = await saveConfiguredProvider({ ...saved, modelId: " manual " });
    assert.deepEqual(
      manual.addedModels?.map((model) => model.id),
      ["default", "vision", "manual"],
    );
    assert.equal(manual.modelId, "manual");
    assert.equal(
      await supportsImages(manual, "default"),
      true,
      "Preserve legacy capability on its original model",
    );
    assert.equal(
      await supportsImages(manual, "manual"),
      false,
      "Never transfer the old image flag to another model",
    );
    const removed = await saveConfiguredProvider({
      ...manual,
      modelId: "default",
      addedModels: [{ id: "default" }],
    });
    assert.equal(hasAddedModel(removed, "vision"), false);
    assert.equal(hasAddedModel(removed, "manual"), false);
    await saveConfiguredProvider({ ...removed, modelId: "", addedModels: [] });
    assert.deepEqual(addedModels((await listConfiguredProviders())[0]), []);
    assert.equal(fetches, 1, "Editing or reading added models must not fetch the catalogue");
  } finally {
    await platform.deleteProvider(input.id);
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});

test("global defaults retain provider identity, migrate old defaults and exclude unavailable chat models", () => {
  const first = {
    id: "first",
    name: "First",
    baseUrl: "https://fixture.invalid",
    enabled: true,
    hasKey: false,
    modelId: "old-default",
    addedModels: [{ id: "shared" }, { id: "old-default" }],
  };
  const second = { ...first, id: "second", modelId: "shared", addedModels: [{ id: "shared" }] };
  const disabled = { ...second, id: "disabled", enabled: false };
  const ocr = { ...second, id: "ocr", purpose: "ocr" as const };
  const empty = { ...first, id: "empty", addedModels: [] };
  const providers = [first, second, disabled, ocr, empty];
  assert.deepEqual(resolveDefaultModel(providers, null, "first"), {
    providerId: "first",
    modelId: "old-default",
  });
  assert.deepEqual(resolveDefaultModel(providers, null, null), {
    providerId: "first",
    modelId: "old-default",
  });
  const selected = { providerId: "second", modelId: "shared" };
  assert.deepEqual(resolveDefaultModel(providers, selected), selected);
  assert.equal(isChatSelection(providers, selected), true);
  for (const providerId of ["disabled", "ocr", "empty", "missing"])
    assert.equal(isChatSelection(providers, { providerId, modelId: "shared" }), false);
  assert.deepEqual(resolveDefaultModel([disabled, ocr, empty, first], selected), {
    providerId: "first",
    modelId: "shared",
  });
  assert.equal(resolveDefaultModel([disabled, ocr, empty], selected), null);
  assert.equal(parseModelSelection("broken"), null);
  assert.equal(parseModelSelection('{"providerId":"first","modelId":42}'), null);
  assert.deepEqual(parseModelSelection(JSON.stringify(selected)), selected);
  const removed = { ...second, addedModels: [] };
  assert.equal(
    isChatSelection([first, removed], selected),
    false,
    "Same-named models on another provider are not the selected pair",
  );
});
