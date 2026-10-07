import assert from "node:assert/strict";
import { test } from "node:test";
import { matchesContext, normalizeKeybinding, parseContext } from "../../src/domain/context-keys";
import {
  decodeConfiguration,
  validateConfiguration,
} from "../../src/domain/extension-configuration";
test("context precedence, comparisons and missing keys remain declarative", () => {
  const values = { open: true, selected: false, mode: "text", page: 3 };
  assert.equal(matchesContext("open && (!selected || missing)", values), true);
  assert.equal(matchesContext("mode == text && page === 3", values), true);
  assert.equal(matchesContext("mode != 'text' || !open", values), false);
  assert.equal(matchesContext("missing", values), false);
  assert.equal(matchesContext("constructor || __proto__", values), false);
  assert.throws(() => parseContext("page == " + "9".repeat(400)), /context/i);
  assert.equal(matchesContext(undefined, values), true);
  for (const input of ["open()", "open; globalThis.x=1", "open &&", "(", "a.b['x']", "open > 3"])
    assert.throws(() => parseContext(input), /context/i);
  assert.throws(() => parseContext("!".repeat(300) + "open"), /context/i);
});
test("keybindings normalize modifiers and reject ambiguous chords", () => {
  assert.equal(normalizeKeybinding("Shift+Ctrl+P"), "ctrl+shift+p");
  assert.equal(normalizeKeybinding("Meta+Alt+Enter"), "alt+meta+enter");
  for (const key of ["ctrl+ctrl+p", "ctrl+k ctrl+s", "", "control+p"])
    assert.throws(() => normalizeKeybinding(key));
});
test("typed settings validate JSON, enums and bounds while preserving legacy strings", () => {
  const legacy = { key: "prompt", title: "Prompt", default: "default" };
  assert.equal(decodeConfiguration(legacy, 'not "JSON"'), 'not "JSON"');
  const count = {
    key: "count",
    title: "Count",
    type: "integer" as const,
    default: 3,
    minimum: 1,
    maximum: 5,
  };
  assert.equal(decodeConfiguration(count, "4"), 4);
  assert.equal(decodeConfiguration(count, '"4"'), 3);
  assert.throws(() => validateConfiguration(count, 0));
  assert.throws(() => validateConfiguration(count, 1.5));
  assert.throws(() => validateConfiguration({ ...legacy, enum: ["a"] }, "b"));
  assert.throws(() =>
    validateConfiguration(
      { key: "json", title: "JSON", type: "object", default: {} },
      { x: undefined },
    ),
  );
  assert.throws(() => validateConfiguration({ ...count, type: "number" }, NaN));
});
