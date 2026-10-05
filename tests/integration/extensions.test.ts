import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext, ExtensionModule, ReaderSelection } from "../../src/sdk";
import { ExtensionHost, type HostPorts } from "../../src/application/extensions/host";
import { extensionFixtureManifest, fixtureExtension } from "../fixtures/extensions";
import { manifest as translatorManifest } from "../../src/extensions/selection-translation/manifest";

function harness(
  module: ExtensionModule,
  manifest = extensionFixtureManifest,
  saved = new Map<string, string>(),
) {
  let context!: ExtensionContext;
  const counters = { ocr: 0, lm: 0, aborted: 0, modelDelta: 0 };
  let deliver: ((delta: string) => void) | undefined;
  const pending = (signal?: AbortSignal) =>
    new Promise<void>((_, reject) =>
      signal?.addEventListener(
        "abort",
        () => {
          counters.aborted++;
          reject(new DOMException("Cancelled", "AbortError"));
        },
        { once: true },
      ),
    );
  const ports: HostPorts = {
    getSetting: async (key) => saved.get(key) ?? null,
    setSetting: async (key, value) => {
      saved.set(key, value);
    },
    documents: {
      getPageFacts: async () => {
        throw new Error("fixture");
      },
      getLayoutObservations: async () => null,
      getSemanticPage: async () => {
        throw new Error("fixture");
      },
      getDocumentSemantics: async () => {
        throw new Error("fixture");
      },
    },
    ocr: {
      reconstructFormulas: async (_, options) => {
        counters.ocr++;
        await pending(options.signal);
        return { assets: [], issues: [] };
      },
    },
    formulas: { exportPdf: async () => new Uint8Array() },
    lm: {
      supportsImages: async () => false,
      complete: async (_, delta, signal) => {
        counters.lm++;
        deliver = delta;
        await pending(signal);
      },
    },
    revealPage() {},
    showError() {},
  };
  const host = new ExtensionHost(
    [
      {
        manifest,
        builtIn: true,
        configurationMigrations: { theme: "legacy-theme" },
        load: async () => ({
          ...module,
          activate: async (next) => {
            context = next;
            await module.activate(next);
          },
        }),
      },
    ],
    ports,
  );
  return {
    host,
    saved,
    counters,
    context: () => context,
    deliver: (delta: string) => deliver?.(delta),
  };
}
const preview: ReaderSelection = {
  documentId: "fixture",
  page: 1,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  text: "Fixture",
  imageDataUrl: "data:image/png;base64,AAAA",
};

test("owner lifecycle removes views, commands, tools, decorations and events; settings survive reactivation", async () => {
  let events = 0;
  const { host, context, saved } = harness({
    activate(ctx) {
      fixtureExtension().activate(ctx);
      ctx.reader.onDidChangeSelection(() => events++);
      ctx.reader.setDecorations("fixture", 1, [
        { id: "box", box: [0, 0, 1, 1], borderColor: "#123456" },
      ]);
      ctx.reader.registerInteractionTool({
        id: "fixture.reader-tools.select",
        title: "Select",
        mode: "rectangle",
        preview: () => [],
        select: () => preview,
      });
      ctx.reader.registerSelectionAction({
        id: "fixture.reader-tools.action",
        title: "Action",
        run() {},
      });
    },
  });
  await host.start();
  assert.equal(host.getSnapshot().views.length, 2);
  assert.equal(host.getSnapshot().tools.length, 1);
  assert.equal(host.getSnapshot().background, "#dae8fa");
  const earlier = context().reader.setBackground("#123456");
  const later = context().reader.setBackground("#abcdef");
  earlier.dispose();
  assert.equal(
    host.getSnapshot().background,
    "#abcdef",
    "Disposing an older layer preserves the current background",
  );
  later.dispose();
  assert.equal(host.getSnapshot().background, "#dae8fa");
  assert.equal(host.getSnapshot().statusItems[0].visible, true);
  await context().globalState.update("result", { value: 4 });
  await context().workspace.getConfiguration().update("theme", "#123456");
  host.publishSelection(preview, "fixture.reader-tools");
  assert.equal(events, 1);
  const stale = context();
  await host.setEnabled("fixture.reader-tools", false);
  const stopped = host.getSnapshot();
  assert.equal(
    stopped.views.length +
      stopped.tools.length +
      stopped.actions.length +
      stopped.statusItems.length +
      stopped.decorations.length,
    0,
  );
  assert.equal(stopped.background, undefined);
  assert.equal(events, 1);
  assert.throws(() => stale.reader.setBackground("red"), { name: "AbortError" });
  await assert.rejects(stale.globalState.update("result", "stale"), { name: "AbortError" });
  await assert.rejects(host.executeCommand("fixture.reader-tools.navigate"), /Unavailable/);
  await assert.rejects(host.uninstall("fixture.reader-tools"), /cannot be uninstalled/);
  assert.equal(saved.get("extensions:fixture.reader-tools:enabled"), "false");
  await host.setEnabled("fixture.reader-tools", true);
  assert.equal(host.getSnapshot().views.length, 2);
  assert.equal(host.getSnapshot().tools.length, 1);
  assert.deepEqual(await context().globalState.get("result", null), { value: 4 });
  assert.equal(await context().workspace.getConfiguration().get("theme"), "#123456");
  host.publishSelection(preview);
  assert.equal(events, 2);
  await host.dispose();
});

test("plugin disable and per-view cancellation abort OCR/LLM requests and suppress late deltas", async () => {
  const { host, context, counters, deliver } = harness({ activate() {} }, translatorManifest);
  await host.start();
  const model = {
    id: "fixture",
    name: "Fixture",
    enabled: true,
    hasKey: false,
    baseUrl: "https://fixture.invalid",
    modelId: "fixture-model",
  };
  const lm = context().lm.complete(
    { providerId: model.id, messages: [{ role: "user", content: "fixture" }] },
    () => counters.modelDelta++,
  );
  const ocr = context().ocr.reconstructFormulas([], { fallback: model, supportsImages: true });
  const rejected = Promise.all([
    assert.rejects(lm, { name: "AbortError" }),
    assert.rejects(ocr, { name: "AbortError" }),
  ]);
  deliver("before");
  await host.setEnabled("cachalot.selection-translation", false);
  deliver("late");
  await rejected;
  assert.equal(counters.aborted, 2);
  assert.equal(counters.modelDelta, 1);
  await host.setEnabled("cachalot.selection-translation", true);
  const controller = new AbortController();
  const closed = context().lm.complete(
    { providerId: model.id, messages: [] },
    () => counters.modelDelta++,
    controller.signal,
  );
  const closing = assert.rejects(closed, { name: "AbortError" });
  controller.abort();
  await closing;
  assert.equal(host.getSnapshot().extensions[0].status, "active");
  await host.dispose();
});

test("failed activation rolls back registrations; missing capabilities and foreign IDs are rejected", async () => {
  let captured!: ExtensionContext;
  const { host } = harness({
    activate(ctx) {
      captured = ctx;
      ctx.window.createStatusBarItem("fixture.reader-tools.partial").show();
      assert.throws(
        () => ctx.commands.registerCommand("another.extension.command", () => undefined),
        /namespace/,
      );
      assert.throws(
        () =>
          ctx.window.registerViewProvider("fixture.reader-tools.undeclared", {
            mount: () => ({ dispose() {} }),
          }),
        /Undeclared/,
      );
      throw new Error("Activation fixture failed");
    },
  });
  await host.start();
  assert.equal(host.getSnapshot().extensions[0].status, "error");
  assert.equal(host.getSnapshot().statusItems.length, 0);
  assert.equal(captured.signal.aborted, true);
  const restricted = harness(
    {
      activate(ctx) {
        captured = ctx;
      },
    },
    { ...extensionFixtureManifest, capabilities: [] },
  );
  await restricted.host.start();
  assert.throws(() => captured.reader.setBackground("red"), /Capability not declared/);
  await assert.rejects(captured.lm.supportsImages({} as never), /Capability not declared/);
  await host.dispose();
  await restricted.host.dispose();
});

test("lazy command activation runs once, and cancellation during activation allows disabling immediately", async () => {
  let activations = 0;
  const lazy = harness(
    {
      activate(ctx) {
        activations++;
        ctx.commands.registerCommand("fixture.reader-tools.navigate", () => "ok");
      },
    },
    { ...extensionFixtureManifest, activationEvents: ["onCommand:fixture.reader-tools.navigate"] },
  );
  await lazy.host.start();
  assert.equal(activations, 0);
  assert.deepEqual(
    await Promise.all([
      lazy.host.executeCommand("fixture.reader-tools.navigate"),
      lazy.host.executeCommand("fixture.reader-tools.navigate"),
    ]),
    ["ok", "ok"],
  );
  assert.equal(activations, 1);
  await lazy.host.dispose();
  let started!: () => void;
  const activating = new Promise<void>((resolve) => {
    started = resolve;
  });
  const slow = harness({
    async activate(ctx) {
      ctx.window.createStatusBarItem("fixture.reader-tools.pending").show();
      started();
      await new Promise(() => undefined);
    },
  });
  const startup = slow.host.start();
  await activating;
  await slow.host.setEnabled("fixture.reader-tools", false);
  await startup;
  assert.equal(slow.host.getSnapshot().extensions[0].status, "disabled");
  assert.equal(slow.host.getSnapshot().statusItems.length, 0);
  await slow.host.dispose();
});

test("legacy configuration is migrated once and does not overwrite a plugin setting", async () => {
  const saved = new Map([["legacy-theme", "#123456"]]);
  const first = harness({ activate() {} }, extensionFixtureManifest, saved);
  await first.host.start();
  assert.equal(await first.context().workspace.getConfiguration().get("theme"), "#123456");
  await first.context().workspace.getConfiguration().update("theme", "#abcdef");
  await first.host.dispose();
  const second = harness({ activate() {} }, extensionFixtureManifest, saved);
  await second.host.start();
  assert.equal(await second.context().workspace.getConfiguration().get("theme"), "#abcdef");
  await second.host.dispose();
});
