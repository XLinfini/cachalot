import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { platform } from "../../src/infrastructure/platform";
import {
  listConfiguredProviders,
  saveConfiguredProvider,
  listModels,
} from "../../src/application/model-catalog";
import { addedModels, hasAddedModel } from "../../src/domain/provider-models";

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

    const manual = await saveConfiguredProvider({ ...saved, modelId: " manual " });
    assert.deepEqual(
      manual.addedModels?.map((model) => model.id),
      ["default", "vision", "manual"],
    );
    assert.equal(manual.modelId, "manual");
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
