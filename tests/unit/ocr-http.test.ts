import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import type { OcrHttpRequest } from "../../src/domain/ocr-adapter";
import { prepareOcrRequest, redactOcrJson } from "../../src/domain/ocr-http";

test("OCR transports share endpoint, auth placement and request validation fixtures", () => {
  const fixtures: Array<{
    baseUrl: string;
    request: OcrHttpRequest;
    invalid?: boolean;
    expected?: { url: string; method: string; headers: Record<string, string>; body?: unknown };
  }> = JSON.parse(readFileSync("tests/fixtures/ocr-http.json", "utf8"));
  for (const fixture of fixtures) {
    if (fixture.invalid) {
      assert.throws(() => prepareOcrRequest(fixture.baseUrl, fixture.request, "fixture-key-1234"));
      continue;
    }
    const result = prepareOcrRequest(fixture.baseUrl, fixture.request, "fixture-key-1234");
    assert.equal(result.url, fixture.expected!.url);
    assert.equal(result.method, fixture.expected!.method);
    assert.deepEqual(result.body ? JSON.parse(result.body) : undefined, fixture.expected!.body);
    for (const [name, value] of Object.entries(fixture.expected!.headers))
      assert.equal(result.headers[name], value);
    const names = Object.keys(result.headers).map((name) => name.toLowerCase());
    assert.equal(new Set(names).size, names.length, "HTTP header names are case insensitive");
    if (fixture.request.auth?.type === "none")
      assert(!JSON.stringify(result).includes("fixture-key-1234"));
  }
  const value = { formula: "x+1", debug: ["echo fixture-key-1234", { key: "fixture-key-1234" }] };
  assert.deepEqual(redactOcrJson(value, "fixture-key-1234"), {
    formula: "x+1",
    debug: ["echo [redacted]", { key: "[redacted]" }],
  });
  assert.equal(
    value.debug[0],
    "echo fixture-key-1234",
    "Redaction must not mutate a parsed vendor response",
  );
});
