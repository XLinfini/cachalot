import { buildSync } from "esbuild";
import { strToU8, zipSync } from "fflate";
import type { ExtensionManifest } from "../../src/sdk";
import { extensionFixtureManifest } from "./extensions";
export function extensionArchive(manifest: ExtensionManifest, source?: string): Buffer {
  const files: Record<string, Uint8Array> = {
    "package.json": strToU8(
      JSON.stringify({ ...manifest, ...(source ? { main: "extension.js" } : {}) }),
    ),
    "assets/note.txt": strToU8("Package asset"),
  };
  if (source)
    files["extension.js"] = buildSync({
      stdin: { contents: source, loader: "ts", resolveDir: process.cwd() },
      bundle: true,
      write: false,
      globalName: "cachalotExtension",
      format: "iife",
      platform: "browser",
      target: "es2022",
    }).outputFiles[0].contents;
  return Buffer.from(zipSync(files));
}
export function providerPackage(version = "0.1.0", failing = false) {
  const manifest: ExtensionManifest = {
    ...extensionFixtureManifest,
    name: "provider",
    displayName: "Fixture API",
    capabilities: [],
    contributes: {},
    activationEvents: [],
  };
  return {
    manifest: { ...manifest, version },
    buffer: extensionArchive(
      { ...manifest, version },
      `export function activate() { ${failing ? 'throw new Error("Provider fixture failed");' : `return { async describe() { return "Provider ${version}"; }, async twice(n) { return n * 2; } };`} }`,
    ),
  };
}
export function consumerPackage() {
  const manifest: ExtensionManifest = JSON.parse(
    JSON.stringify(extensionFixtureManifest).replaceAll("reader-tools", "consumer"),
  );
  manifest.extensionDependencies = ["fixture.provider"];
  manifest.capabilities.push("lm");
  return {
    manifest,
    buffer: extensionArchive(
      manifest,
      `
    export function deactivate() { console.debug("Fixture consumer deactivated"); }
    export async function activate(ctx) {
      const api = ctx.extensions.getExtension('fixture.provider').exports;
      const description = await api.describe();
      const count = await ctx.globalState.get('activations', 0) + 1;
      await ctx.globalState.update('activations', count);
      ctx.reader.setBackground('#dae8fa');
      ctx.commands.registerCommand('fixture.consumer.navigate', async () => {
        const id = ctx.reader.activeDocumentId;
        if (id) ctx.reader.revealPage(id, 1);
        return await api.twice(3);
      });
      ctx.window.registerTreeDataProvider('fixture.consumer.tree', { getChildren: async () => [{id:'first',label:await api.describe(),command:{command:'fixture.consumer.navigate'}}] });
      ctx.window.registerWebviewViewProvider('fixture.consumer.web', {
        resolveWebviewView(webview, view) {
          webview.html = '<button id="send">Ping host</button><button id="lm">Use model</button><p id="result">Ready</p><script>document.getElementById("send").onclick=()=>parent.postMessage({kind:"ping"},"*");document.getElementById("lm").onclick=()=>parent.postMessage({kind:"lm"},"*");addEventListener("message",event=>document.getElementById("result").textContent=event.data.text)</script>';
          return webview.onDidReceiveMessage(async message => {
            if (message.kind === 'ping') webview.postMessage({text:new TextDecoder().decode(await ctx.resources.read('assets/note.txt')) + ' / ' + await api.describe()});
            if (message.kind === 'lm') {
              const model = ctx.lm.activeModel;
              await ctx.lm.complete({providerId:model.id, messages:[{role:'user',content:'plugin request'}]}, delta => webview.postMessage({text:delta}), view.signal);
            }
          });
        }
      });
      ctx.window.showView('fixture.consumer.tree');
      ctx.window.showView('fixture.consumer.web');
      const status = ctx.window.createStatusBarItem('fixture.consumer.status','right');
      status.text = 'Installed ' + count + ' / ' + description; status.command='fixture.consumer.navigate'; status.show();
      ctx.reader.registerHoverProvider({provideHover:async()=>({zh:'安装插件摘要',en:'Installed hover'})});
      return { async isolation() {
        let storage = 'blocked'; try { indexedDB.open('forbidden'); storage='available'; } catch {}
        let network='blocked'; try { await fetch('https://fixture.invalid'); network='available'; } catch {}
        return {document:typeof document,tauri:typeof __TAURI_INTERNALS__,storage,network};
      } };
    }
  `,
    ),
  };
}
export const stuckPackage = () => {
  const manifest: ExtensionManifest = {
    ...extensionFixtureManifest,
    name: "stuck",
    displayName: "Stuck fixture",
    capabilities: [],
    contributes: { commands: [{ command: "fixture.stuck.spin", title: "Spin" }] },
  };
  return {
    manifest,
    buffer: extensionArchive(
      manifest,
      `export function activate(ctx) { ctx.commands.registerCommand('fixture.stuck.spin', () => { while(true){} }); }`,
    ),
  };
};

export const eventPackage = () => {
  const manifest: ExtensionManifest = {
    ...extensionFixtureManifest,
    name: "events",
    displayName: "Event fixture",
    capabilities: [],
    contributes: {},
  };
  return {
    manifest,
    buffer: extensionArchive(
      manifest,
      `export function activate(ctx) {
        let first=0, second=0;
        const subscription=ctx.localization.onDidChangeLanguage(() => first++);
        ctx.localization.onDidChangeLanguage(() => second++);
        return {
          async counts() { return {first,second,language:ctx.localization.language}; },
          async detachFirst() { subscription.dispose(); }
        };
      }`,
    ),
  };
};
