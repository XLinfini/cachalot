import assert from "node:assert/strict";
import { test } from "node:test";
import "fake-indexeddb/auto";
import { zipSync, strToU8 } from "fflate";
import { parseExtensionPackage } from "../../src/infrastructure/extensions/package";
import { ExtensionRepository } from "../../src/infrastructure/extensions/repository";
import { validateManifest } from "../../src/infrastructure/extensions/manifest";
import { extensionFixtureManifest } from "../fixtures/extensions";

const base = { ...extensionFixtureManifest, main: "extension.js" };
const archive = (manifest: unknown = base, extra: Record<string, Uint8Array> = {}) =>
  zipSync(
    {
      "package.json": strToU8(JSON.stringify(manifest)),
      "extension.js": strToU8("var cachalotExtension = { activate() {} };"),
      ...extra,
    },
    { level: 0 },
  );

test("package validation checks engines, owned contributions, assets, checksum and ZIP traversal before execution", async () => {
  const pkg = await parseExtensionPackage(archive(base, { "assets/note.txt": strToU8("fixture") }));
  assert.equal(pkg.id, "fixture.reader-tools");
  assert.match(pkg.digest, /^[a-f0-9]{64}$/);
  assert.equal(new TextDecoder().decode(pkg.files["assets/note.txt"]), "fixture");
  await assert.rejects(
    parseExtensionPackage(archive({ ...base, engines: { cachalot: "^5.0.0" } })),
    /engines/,
  );
  await assert.rejects(parseExtensionPackage(archive({ ...base, main: "../outside.js" })), /main/);
  await assert.rejects(
    parseExtensionPackage(archive(base, { "../outside": strToU8("x") })),
    /entry/,
  );
  await assert.rejects(
    parseExtensionPackage(archive(base, { "assets\\outside": strToU8("x") })),
    /entry/,
  );
  await assert.rejects(
    parseExtensionPackage(
      archive({
        ...base,
        contributes: { commands: [{ command: "foreign.plugin.run", title: "Run" }] },
      }),
    ),
    /namespace/,
  );
  await assert.rejects(
    parseExtensionPackage(archive({ ...base, extensionDependencies: ["fixture.reader-tools"] })),
    /extensionDependencies/,
  );
  const corrupt = archive();
  const entryOffset = 30 + "package.json".length;
  corrupt[entryOffset + 3] ^= 1;
  await assert.rejects(parseExtensionPackage(corrupt), /checksum/);
  await assert.rejects(parseExtensionPackage(new Uint8Array(17 * 1024 * 1024)), /size/);
  assert.doesNotThrow(() => validateManifest({ ...base, engines: { cachalot: ">=0.1.0 <0.2.0" } }));
});

test("package storage persists batches and updates atomically; removal preserves unrelated packages", async () => {
  const repository = new ExtensionRepository();
  const first = await parseExtensionPackage(archive());
  const second = await parseExtensionPackage(
    archive({ ...base, name: "second", contributes: undefined }),
  );
  await repository.change([first, second]);
  const reopened = new ExtensionRepository();
  assert.equal((await reopened.list()).length, 2);
  const update = await parseExtensionPackage(archive({ ...base, version: "0.2.0" }));
  await reopened.change([update]);
  assert.equal(
    (await repository.list()).find((item) => item.id === first.id)!.manifest.version,
    "0.2.0",
  );
  // A non-cloneable package aborts the entire transaction, including earlier queued writes.
  await assert.rejects(
    repository.change([
      { ...first, manifest: { ...first.manifest, version: "0.3.0" } },
      { ...second, files: { invalid: (() => {}) as never } },
    ]),
  );
  assert.equal(
    (await repository.list()).find((item) => item.id === first.id)!.manifest.version,
    "0.2.0",
  );
  await repository.change([], [first.id]);
  assert.deepEqual(
    (await repository.list()).map((item) => item.id),
    [second.id],
  );
  await repository.change([], [second.id]);
});

import { ExtensionHost, type HostPorts } from "../../src/application/extensions/host";
import {
  ExtensionInstaller,
  packageInstallation,
} from "../../src/application/extensions/installer";
const memoryPorts = (): HostPorts => {
  const settings = new Map<string, string>();
  const unavailable = async (): Promise<never> => {
    throw new Error("No open fixture document");
  };
  return {
    getSetting: async (key) => settings.get(key) ?? null,
    setSetting: async (key, value) => {
      settings.set(key, value);
    },
    documents: {
      getPageFacts: unavailable,
      getLayoutObservations: async () => null,
      getSemanticPage: unavailable,
      getDocumentSemantics: unavailable,
    },
    ocr: { reconstructFormulas: async () => ({ assets: [], issues: [] }) },
    formulas: { exportPdf: async () => new Uint8Array() },
    lm: { supportsImages: async () => false, complete: async () => {} },
    revealPage() {},
    showError() {},
  };
};

test("installation plans require complete dependency batches, protect built-ins and install packs independently", async () => {
  const repository = new ExtensionRepository();
  const host = new ExtensionHost(
    [
      {
        manifest: { ...extensionFixtureManifest, activationEvents: [], contributes: {} },
        builtIn: true,
        load: async () => ({ activate() {} }),
      },
    ],
    {
      ...memoryPorts(),
      catalog: {
        load: async () => (await repository.list()).map(packageInstallation),
        remove: (ids) => repository.change([], ids),
      },
    },
  );
  await host.start();
  const installer = new ExtensionInstaller(host, repository);
  const pack = (name: string, members: string[]) =>
    parseExtensionPackage(
      archive({ ...base, name, main: undefined, contributes: {}, extensionPack: members }),
    );
  const missing = await pack("group", ["fixture.member"]);
  assert.deepEqual(installer.plan([missing]).missing, ["fixture.member"]);
  await assert.rejects(installer.install(installer.plan([missing])), /Resolve/);
  assert.equal((await repository.list()).length, 0);
  const member = await pack("member", ["fixture.reader-tools"]);
  await installer.install(installer.plan([missing, member]));
  assert.equal(
    host.getSnapshot().extensions.find((item) => item.id === "fixture.group")!.status,
    "active",
  );
  await host.uninstall("fixture.group");
  assert.ok(host.getSnapshot().extensions.some((item) => item.id === "fixture.member"));
  assert.equal((await repository.list()).length, 1);
  const builtInOverride = await parseExtensionPackage(archive());
  assert.deepEqual(installer.plan([builtInOverride]).blockedBuiltIns, ["fixture.reader-tools"]);
  await assert.rejects(installer.install(installer.plan([builtInOverride])), /Resolve/);
  await host.dispose();
  const recovered = new ExtensionHost([], {
    ...memoryPorts(),
    catalog: {
      load: async () => (await repository.list()).map(packageInstallation),
      remove: (ids) => repository.change([], ids),
    },
  });
  await recovered.start();
  assert.equal(recovered.getSnapshot().extensions[0].id, "fixture.member");
  await recovered.dispose();
  await repository.change([], [member.id]);
});

test("a failed host installation restores the previous persistent package without removing unrelated packages", async () => {
  const repository = new ExtensionRepository();
  const first = await parseExtensionPackage(archive()),
    update = await parseExtensionPackage(archive({ ...base, version: "0.2.0" }));
  await repository.change([first]);
  class RejectingHost extends ExtensionHost {
    override async installBatch(): Promise<void> {
      throw new Error("Host installation fixture rejected");
    }
  }
  const host = new RejectingHost([], memoryPorts());
  const installer = new ExtensionInstaller(host, repository);
  await assert.rejects(installer.install(installer.plan([update])), /Host installation fixture/);
  assert.equal((await repository.list())[0].manifest.version, "0.1.0");
  await repository.change([], [first.id]);
  await host.dispose();
});
