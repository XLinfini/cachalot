import assert from "node:assert/strict";
import { test } from "node:test";
import "../support/register-ocr";

test("desktop OCR uses the generic transport without exposing a credential or vendor command", async () => {
  const calls: Array<{ command: string; input: unknown }> = [];
  Object.defineProperty(globalThis, "isTauri", { configurable: true, value: true });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, input: Record<string, unknown>) => {
          calls.push({ command, input });
          assert.equal(command, "ocr_http");
          assert.deepEqual(input, {
            input: {
              providerId: "native-ocr-fixture",
              url: "https://ocr.invalid/api/paas/v4/layout_parsing",
              body: {
                model: "glm-ocr-alias",
                file: "data:image/png;base64,AAAA",
                return_crop_images: false,
                need_layout_visualization: false,
              },
            },
          });
          return {
            body: { layout_details: [[{ label: "formula", content: "$$x^2=1$$" }]] },
            details: "native fixture",
          };
        },
      },
    },
  });
  try {
    const { recognizeFormulas } = await import("../../src/infrastructure/ocr/formula-ocr");
    const result = await recognizeFormulas(
      "glm-layout",
      {
        id: "native-ocr-fixture",
        name: "Native fixture",
        enabled: true,
        hasKey: true,
        baseUrl: "https://ocr.invalid/api/paas/v4",
        modelId: "glm-ocr-alias",
      },
      [{ id: "equation-one", imageDataUrl: "data:image/png;base64,AAAA" }],
    );
    assert.deepEqual(result, [{ id: "equation-one", latex: "x^2=1" }]);
    assert.equal(calls.length, 1);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "isTauri");
  }
});
