import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { providerErrorDetails } from "../../src/infrastructure/provider-error";
import { platform } from "../../src/infrastructure/platform";
import { parseMessage } from "../../src/domain/messages";

const fixtures: Array<{
  body: string;
  headers: Record<string, string>;
  secret?: string;
  contains: string[];
  excludes?: string[];
}> = JSON.parse(
  await readFile(new URL("../fixtures/provider-errors.json", import.meta.url), "utf8"),
);

test("provider body and request IDs survive credential redaction", () => {
  for (const fixture of fixtures) {
    const details = providerErrorDetails(
      fixture.body,
      new Headers(fixture.headers),
      fixture.secret,
    );
    for (const text of fixture.contains)
      assert.ok(details.includes(text), "missing diagnostic text");
    for (const text of fixture.excludes || [])
      assert.ok(!details.includes(text), "credentials must not reach the UI");
  }
  const full = "x".repeat(500) + "actual upstream failure reason";
  assert.ok(
    providerErrorDetails(full).includes("actual upstream failure reason"),
    "old 400-character truncation must not hide the cause",
  );
  assert.equal(Array.from(providerErrorDetails("α".repeat(20000))).length, 16386);
});

test("HTTP errors and streamed errors reach the application rather than becoming empty responses", async () => {
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const originalFetch = globalThis.fetch;
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
  const provider = {
    id: "error-fixture",
    name: "Fixture",
    baseUrl: "https://fixture.invalid",
    modelId: "fixture-model",
    enabled: true,
    apiKey: "sk-fixture-only-abcd",
  };
  const assertError = async (run: () => Promise<unknown>, code: string, expected: string) => {
    await assert.rejects(run, (cause: unknown) => {
      const descriptor = parseMessage(String(cause));
      assert.equal(descriptor?.code, code);
      if (code !== "completionStreamError") assert.equal(descriptor?.values.status, 503);
      if (expected) assert.ok(String(descriptor?.values.details).includes(expected));
      assert.ok(!String(cause).includes(activeKey));
      return true;
    });
  };
  let activeKey = provider.apiKey;
  const complete = () =>
    platform.complete(
      { providerId: provider.id, messages: [{ role: "user", content: "fixture" }] },
      () => {},
    );
  try {
    await platform.saveProvider(provider);
    for (const fixture of fixtures) {
      activeKey = fixture.secret || provider.apiKey;
      await platform.saveProvider({ ...provider, apiKey: activeKey });
      globalThis.fetch = async () =>
        new Response(fixture.body || null, { status: 503, headers: fixture.headers });
      const hasDetails = !!providerErrorDetails(
        fixture.body,
        new Headers(fixture.headers),
        activeKey,
      );
      await assertError(
        complete,
        hasDetails ? "completionHttpDetails" : "completionHttp",
        fixture.contains[0] || "",
      );
      await assertError(
        () => platform.listModels(provider.id),
        hasDetails ? "modelsHttpDetails" : "modelsHttp",
        fixture.contains[0] || "",
      );
    }
    globalThis.fetch = async () =>
      new Response(
        'data: {"error":{"message":"Upstream channel closed","code":"channel_failure"}}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    await assertError(complete, "completionStreamError", "Upstream channel closed");
  } finally {
    await platform.deleteProvider(provider.id);
    globalThis.fetch = originalFetch;
    if (originalStorage) Object.defineProperty(globalThis, "localStorage", originalStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
