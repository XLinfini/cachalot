import assert from "node:assert/strict";
import i18n from "i18next";
import { locales as extensionLocales } from "../../src/extensions/selection-translation/locales";
import { en } from "../../src/i18n/locales/en";
import { zh } from "../../src/i18n/locales/zh";
import { localizeMessage } from "../../src/i18n/messages";
import { message, parseMessage } from "../../src/domain/messages";

function leaves(object: object, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object).flatMap(([key, value]) =>
      typeof value === "string"
        ? [[prefix + key, value]]
        : Object.entries(leaves(value, `${prefix}${key}.`)),
    ),
  );
}
const english = leaves(en),
  chinese = leaves(zh);
assert.deepEqual(
  Object.keys(english).sort(),
  Object.keys(chinese).sort(),
  "both dictionaries must be complete",
);
for (const key of Object.keys(english)) {
  assert.deepEqual(
    english[key].match(/{{\w+}}/g)?.sort() || [],
    chinese[key].match(/{{\w+}}/g)?.sort() || [],
    `interpolation values must match: ${key}`,
  );
}
const extensionEnglish = leaves(extensionLocales.en), extensionChinese = leaves(extensionLocales.zh);
assert.deepEqual(Object.keys(extensionEnglish).sort(), Object.keys(extensionChinese).sort());
for (const key of Object.keys(extensionEnglish)) assert.deepEqual(extensionEnglish[key].match(/{{\w+}}/g)?.sort() || [], extensionChinese[key].match(/{{\w+}}/g)?.sort() || [], `extension interpolation: ${key}`);

await i18n.init({
  lng: "en",
  fallbackLng: "zh",
  resources: { en: { translation: en }, zh: { translation: zh } },
  interpolation: { escapeValue: false },
});
const failure = String(new Error(message("pdfPage", { page: 3 })));
assert.equal(localizeMessage(failure), "Could not load page 3.");
assert.equal(
  localizeMessage("12 个字符位于模型区域之外，已保留为待核对文字。"),
  "12 characters outside model regions were kept for review.",
);
assert.equal(
  localizeMessage("模型请求失败（400 Bad Request）：diagnostic details"),
  "Model request failed (400 Bad Request): diagnostic details",
);
assert.equal(localizeMessage("HTTP 502: server diagnostic"), "HTTP 502: server diagnostic");
assert.equal(
  localizeMessage("模型请求失败（502）：line one\nline two"),
  "Model request failed (502): line one\nline two",
);
assert.equal(i18n.t("common.pages", { count: 1 }), "1 page");
assert.equal(i18n.t("common.pages", { count: 7 }), "7 pages");
await i18n.changeLanguage("zh");
assert.equal(localizeMessage(failure), "无法加载第 3 页。");
assert.equal(i18n.t("common.pages", { count: 7 }), "7 页");
assert.equal(parseMessage("cachalot-message:{bad json}"), null);
assert.equal(parseMessage('cachalot-message:{"code":"unknown","values":{}}'), null);
console.log(
  `i18n checks passed: ${Object.keys(english).length} keys, interpolation, plurals, coded errors and legacy cache/native errors`,
);
