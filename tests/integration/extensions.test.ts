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
            return await module.activate(next);
          },
        }),
      },
    ],
    ports,
  );
  return {
    host,
    ports,
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

function dependencyManifest(name: string, dependencies: string[] = [], pack: string[] = []) {
  return {
    ...extensionFixtureManifest,
    name,
    displayName: name,
    extensionDependencies: dependencies,
    extensionPack: pack,
    contributes: { commands: [{ command: `fixture.${name}.run`, title: "Run" }] },
  };
}
function installation(
  manifest: ReturnType<typeof dependencyManifest>,
  activate: ExtensionModule["activate"],
  builtIn = false,
) {
  return { manifest, builtIn, load: async () => ({ activate }) };
}

test("hard dependencies activate before consumers, share activation and expose declared APIs; packs are independent", async () => {
  const { ports } = harness({ activate() {} });
  const order: string[] = [];
  const host = new ExtensionHost(
    [
      installation(
        dependencyManifest("consumer", ["fixture.left", "fixture.right"]),
        async (ctx) => {
          const api = ctx.extensions.getExtension<{ add(a: number, b: number): number }>(
            "fixture.left",
          )!.exports;
          assert.equal(api.add(2, 3), 5);
          assert.throws(() => ctx.extensions.getExtension("fixture.pack"), /Undeclared/);
          ctx.commands.registerCommand("fixture.consumer.run", () => "consumer");
          order.push("consumer");
        },
      ),
      installation(dependencyManifest("left", ["fixture.shared"]), () => {
        order.push("left");
        return { add: (a: number, b: number) => a + b };
      }),
      installation(dependencyManifest("right", ["fixture.shared"]), () => {
        order.push("right");
      }),
      installation(dependencyManifest("shared"), () => {
        order.push("shared");
      }),
      installation(
        { ...dependencyManifest("pack", [], ["fixture.consumer"]), activationEvents: [] },
        () => {
          throw new Error("A pack must not activate its members as hard dependencies");
        },
      ),
    ],
    ports,
  );
  await host.start();
  assert.equal(order.filter((value) => value === "shared").length, 1);
  assert.ok(order.indexOf("shared") < order.indexOf("left"));
  assert.ok(order.indexOf("left") < order.indexOf("consumer"));
  assert.ok(order.indexOf("right") < order.indexOf("consumer"));
  await host.uninstall("fixture.pack");
  assert.equal(await host.executeCommand("fixture.consumer.run"), "consumer");
  await host.dispose();
});

test("missing, disabled, failing and circular dependencies block consumers without hanging unrelated extensions", async () => {
  const { ports } = harness({ activate() {} });
  let consumers = 0,
    healthy = 0;
  const host = new ExtensionHost(
    [
      installation(dependencyManifest("missing-user", ["fixture.absent"]), () => {
        consumers++;
      }),
      installation(dependencyManifest("cycle-a", ["fixture.cycle-b"]), () => {
        consumers++;
      }),
      installation(dependencyManifest("cycle-b", ["fixture.cycle-a"]), () => {
        consumers++;
      }),
      installation(dependencyManifest("failing-user", ["fixture.failing"]), () => {
        consumers++;
      }),
      installation(dependencyManifest("failing"), () => {
        throw new Error("dependency failure");
      }),
      installation(dependencyManifest("healthy"), () => {
        healthy++;
      }),
    ],
    ports,
  );
  await host.start();
  assert.equal(consumers, 0);
  assert.equal(healthy, 1);
  const find = (id: string) =>
    host.getSnapshot().extensions.find((item) => item.id === `fixture.${id}`)!;
  assert.equal(find("missing-user").problem?.kind, "missing");
  assert.equal(find("cycle-a").problem?.kind, "cycle");
  assert.equal(find("failing-user").problem?.kind, "failed");
  await host.install(installation(dependencyManifest("absent"), () => undefined));
  assert.equal(find("missing-user").status, "active");
  assert.equal(consumers, 1);
  await host.dispose();

  const saved = new Map([["extensions:fixture.provider:enabled", "false"]]);
  const isolated = harness({ activate() {} }, extensionFixtureManifest, saved);
  const disabled = new ExtensionHost(
    [
      installation(dependencyManifest("consumer", ["fixture.provider"]), () => undefined),
      installation(dependencyManifest("provider"), () => undefined),
    ],
    isolated.ports,
  );
  await disabled.start();
  assert.equal(disabled.getSnapshot().extensions[0].problem?.kind, "disabled");
  await disabled.setEnabled("fixture.consumer", true);
  assert.ok(
    disabled.getSnapshot().extensions.every((item) => item.enabled && item.status === "active"),
  );
  await disabled.dispose();
});

test("disable and uninstall require explicit dependent handling; updates restart consumers and preserve unrelated scopes", async () => {
  const { ports } = harness({ activate() {} });
  let providerRuns = 0,
    consumerRuns = 0,
    unrelatedRuns = 0;
  const contexts: ExtensionContext[] = [];
  const host = new ExtensionHost(
    [
      installation(dependencyManifest("provider"), (ctx) => {
        providerRuns++;
        contexts.push(ctx);
        return { version: 1 };
      }),
      installation(dependencyManifest("consumer", ["fixture.provider"]), (ctx) => {
        consumerRuns++;
        contexts.push(ctx);
        ctx.commands.registerCommand(
          "fixture.consumer.run",
          () =>
            ctx.extensions.getExtension<{ version: number }>("fixture.provider")!.exports.version,
        );
      }),
      installation(dependencyManifest("unrelated"), (ctx) => {
        unrelatedRuns++;
        contexts.push(ctx);
      }),
    ],
    ports,
  );
  await host.start();
  await assert.rejects(host.setEnabled("fixture.provider", false), /Enabled dependents/);
  await assert.rejects(host.uninstall("fixture.provider"), /Installed dependents/);
  const unrelated = contexts.find((ctx) => ctx.extension.id === "fixture.unrelated")!;
  const old = contexts.find((ctx) => ctx.extension.id === "fixture.consumer")!;
  await old.globalState.update("saved", "preserved");
  await host.installBatch([
    installation({ ...dependencyManifest("provider"), version: "0.2.0" }, () => {
      providerRuns++;
      return { version: 2 };
    }),
  ]);
  assert.equal(await host.executeCommand("fixture.consumer.run"), 2);
  assert.equal(old.signal.aborted, true);
  assert.equal(unrelated.signal.aborted, false);
  assert.equal(providerRuns, 2);
  assert.equal(consumerRuns, 2);
  assert.equal(unrelatedRuns, 1);
  assert.equal(await contexts.at(-1)!.globalState.get("saved", "absent"), "preserved");
  await host.setEnabled("fixture.provider", false, { cascade: true });
  assert.equal(
    host.getSnapshot().extensions.find((item) => item.id === "fixture.consumer")!.enabled,
    false,
  );
  await host.setEnabled("fixture.consumer", true);
  assert.equal(await host.executeCommand("fixture.consumer.run"), 2);
  await host.restart("fixture.provider");
  assert.equal(unrelatedRuns, 1);
  await host.uninstall("fixture.provider", { cascade: true });
  assert.deepEqual(
    host.getSnapshot().extensions.map((item) => item.id),
    ["fixture.unrelated"],
  );
  await host.dispose();
});

test("built-in consumers prevent cascading uninstall and an invalid update preserves existing registrations", async () => {
  const { ports } = harness({ activate() {} });
  const host = new ExtensionHost(
    [
      installation(dependencyManifest("provider"), (ctx) => {
        ctx.reader.setBackground("blue");
      }),
      installation(dependencyManifest("built-in", ["fixture.provider"]), () => undefined, true),
    ],
    ports,
  );
  await host.start();
  await assert.rejects(
    host.uninstall("fixture.provider", { cascade: true }),
    /cannot be uninstalled/,
  );
  await assert.rejects(
    host.installBatch([
      installation(
        { ...dependencyManifest("provider"), engines: { cachalot: "^2.0.0" } },
        () => undefined,
      ),
    ]),
    /engines/,
  );
  assert.equal(host.getSnapshot().background, "blue");
  assert.ok(host.getSnapshot().extensions.every((item) => item.status === "active"));
  await host.dispose();
});

test("a provider runtime fault aborts consumers and leaves unrelated extensions active, then restart recovers", async () => {
  const { ports } = harness({ activate() {} });
  let fail!: (error: Error) => void;
  const scopes = new Map<string, ExtensionContext>();
  const host = new ExtensionHost(
    [
      {
        manifest: dependencyManifest("provider"),
        builtIn: false,
        load: async () => ({
          onDidFail(listener) {
            fail = listener;
            return { dispose() {} };
          },
          activate(ctx) {
            scopes.set(ctx.extension.id, ctx);
            return { value: 1 };
          },
        }),
      },
      installation(dependencyManifest("consumer", ["fixture.provider"]), (ctx) => {
        scopes.set(ctx.extension.id, ctx);
      }),
      installation(dependencyManifest("unrelated"), (ctx) => {
        scopes.set(ctx.extension.id, ctx);
      }),
    ],
    ports,
  );
  await host.start();
  fail(new Error("Worker fault fixture"));
  await new Promise((resolve) => setImmediate(resolve));
  const snapshot = host.getSnapshot();
  assert.equal(snapshot.extensions.find((item) => item.id === "fixture.provider")!.status, "error");
  assert.equal(
    snapshot.extensions.find((item) => item.id === "fixture.consumer")!.problem?.kind,
    "failed",
  );
  assert.equal(scopes.get("fixture.consumer")!.signal.aborted, true);
  assert.equal(scopes.get("fixture.unrelated")!.signal.aborted, false);
  await host.restart("fixture.provider");
  assert.ok(host.getSnapshot().extensions.every((item) => item.status === "active"));
  await host.dispose();
});

test("local installation and targeted restart do not retry unrelated failed extensions", async () => {
  const { ports } = harness({ activate() {} });
  let failedAttempts = 0;
  const host = new ExtensionHost(
    [
      installation(dependencyManifest("provider"), () => undefined),
      installation(dependencyManifest("consumer", ["fixture.provider"]), () => undefined),
      installation(dependencyManifest("unrelated-failure"), () => {
        failedAttempts++;
        throw new Error("Unrelated failure");
      }),
    ],
    ports,
  );
  await host.start();
  assert.equal(failedAttempts, 1);
  await host.install(installation(dependencyManifest("new"), () => undefined));
  await host.restart("fixture.provider");
  await host.setEnabled("fixture.consumer", true);
  assert.equal(failedAttempts, 1);
  assert.equal(
    host.getSnapshot().extensions.find((item) => item.id === "fixture.unrelated-failure")!.status,
    "error",
  );
  await host.dispose();
});
