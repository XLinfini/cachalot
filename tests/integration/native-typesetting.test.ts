import assert from "node:assert/strict";
import { test } from "node:test";

test("native typesetting transports copied assets, outputs and an owned cancellation ID", async () => {
  const calls: Array<{ command: string; args: Record<string, any> }> = [];
  Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: Record<string, any>) => {
          calls.push({ command, args });
          if (command === "register_ai_request" || command === "cancel_ai_request") return;
          if (command === "typesetting_compile")
            return {
              success: true,
              pdf: btoa("%PDF-fixture"),
              log: "done",
              files: [{ name: "slots.csv", dataBase64: btoa("f1,10pt,8pt,2pt") }],
            };
          throw new Error(`Unexpected command ${command}`);
        },
      },
    },
  });
  try {
    const { typesetting } = await import("../../src/infrastructure/typesetting");
    const controller = new AbortController();
    const result = await typesetting.compile(
      {
        source: "中文",
        assets: [{ name: "formula.pdf", bytes: new Uint8Array([1, 2, 3]) }],
        returnFiles: ["slots.csv"],
        passes: 2,
      },
      controller.signal,
    );
    assert.deepEqual(
      calls.map(({ command }) => command),
      ["register_ai_request", "typesetting_compile", "cancel_ai_request"],
    );
    const id = calls[0].args.requestId;
    assert.equal(calls[1].args.requestId, id);
    assert.equal(calls[2].args.requestId, id);
    assert.deepEqual(calls[1].args.input, {
      source: "中文",
      assets: [{ name: "formula.pdf", dataBase64: "AQID" }],
      returnFiles: ["slots.csv"],
      passes: 2,
    });
    assert.equal(new TextDecoder().decode(result.pdf!), "%PDF-fixture");
    assert.equal(new TextDecoder().decode(result.files[0].bytes), "f1,10pt,8pt,2pt");
    controller.abort();
    await assert.rejects(typesetting.compile({ source: "ignored" }, controller.signal), {
      name: "AbortError",
    });
    assert.equal(calls.length, 3);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "isTauri");
  }
});

test("browser reports a desktop-only runtime and never tries native compilation", async () => {
  const { typesetting } = await import("../../src/infrastructure/typesetting");
  assert.deepEqual(await typesetting.getStatus(), {
    available: false,
    initialized: false,
    mode: "bundled",
    runtimeId: null,
    reason: "desktop-only",
  });
  await assert.rejects(typesetting.compile({ source: "test" }), /desktop application/);
});
