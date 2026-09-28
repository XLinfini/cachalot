import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { apiEndpoint } from "../../src/domain/api-endpoint";
import { platform } from "../../src/infrastructure/platform";

const cases: Array<{ baseUrl: string; models: string; chat: string }> = JSON.parse(
  await readFile(new URL("../fixtures/api-endpoints.json", import.meta.url), "utf8"),
);

test("browser and native endpoint fixtures describe the displayed request URLs", () => {
  for (const fixture of cases) {
    assert.equal(apiEndpoint(fixture.baseUrl, "models"), fixture.models);
    assert.equal(apiEndpoint(fixture.baseUrl, "chat/completions"), fixture.chat);
  }
  for (const invalid of ["", "infai.cc", "ftp://infai.cc", "not a URL"])
    assert.throws(() => apiEndpoint(invalid, "models"));
});

test("real browser adapter requests match the preview and preserve the key", async () => {
  const stored = new Map<string, string>();
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const oldFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    return init?.method === "POST"
      ? new Response(
          'data: {"choices":[{"delta":{"content":"fixture answer"}}]}\n\ndata: [DONE]\n\n',
          { headers: { "Content-Type": "text/event-stream" } },
        )
      : Response.json({ data: [{ id: "fixture-model", owned_by: "fixture" }] });
  };
  try {
    for (const fixture of cases) {
      await platform.saveProvider({
        id: "endpoint-fixture",
        name: "Fixture",
        baseUrl: fixture.baseUrl,
        modelId: "fixture-model",
        enabled: true,
        apiKey: "sk-not-a-real-key-abcd",
      });
      assert.deepEqual(await platform.listModels("endpoint-fixture"), [
        { id: "fixture-model", ownedBy: "fixture" },
      ]);
      let answer = "";
      await platform.complete(
        {
          providerId: "endpoint-fixture",
          messages: [{ role: "user", content: "fixture question" }],
        },
        (delta) => {
          answer += delta;
        },
      );
      assert.equal(answer, "fixture answer");
      const [models, chat] = requests.splice(0);
      assert.equal(models.url, fixture.models);
      assert.equal(chat.url, fixture.chat);
      assert.equal(
        new Headers(models.init?.headers).get("Authorization"),
        "Bearer sk-not-a-real-key-abcd",
      );
      assert.equal(
        new Headers(chat.init?.headers).get("Authorization"),
        "Bearer sk-not-a-real-key-abcd",
      );
    }
  } finally {
    await platform.deleteProvider("endpoint-fixture");
    globalThis.fetch = oldFetch;
    if (oldStorage) Object.defineProperty(globalThis, "localStorage", oldStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
