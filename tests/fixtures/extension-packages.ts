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
              await ctx.lm.complete({providerId:model.id, modelId:model.modelId, messages:[{role:'user',content:'plugin request'}]}, delta => webview.postMessage({text:delta}), view.signal);
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

export function workbenchPackage() {
  const manifest: ExtensionManifest = {
    ...extensionFixtureManifest,
    name: "workbench",
    engines: { cachalot: "^0.1.1" },
    displayName: "Workbench fixture",
    capabilities: ["documents.read", "reader.interact"],
    contributes: {
      commands: [
        {
          command: "fixture.workbench.run",
          title: { zh: "插件交互", en: "Plugin interaction" },
          enablement:
            "reader.documentOpen && fixture.workbench.ready && config.fixture.workbench.enabled",
        },
        {
          command: "fixture.workbench.ping",
          title: "Context ping",
          enablement: "reader.documentOpen",
        },
      ],
      menus: [
        {
          location: "reader.toolbar",
          command: "fixture.workbench.run",
          when: "reader.documentOpen",
        },
        {
          location: "reader.context",
          command: "fixture.workbench.ping",
          when: "reader.documentOpen",
        },
      ],
      keybindings: [
        { command: "fixture.workbench.ping", key: "ctrl+alt+b", when: "reader.documentOpen" },
      ],
      configuration: [
        {
          key: "enabled",
          title: { zh: "启用交互", en: "Enable interaction" },
          type: "boolean",
          default: true,
        },
        {
          key: "limit",
          title: { zh: "结果数量", en: "Result limit" },
          type: "integer",
          default: 3,
          minimum: 1,
          maximum: 10,
        },
      ],
    },
  };
  return {
    manifest,
    buffer: extensionArchive(
      manifest,
      [
        "export async function activate(ctx) {",
        "  const status = ctx.window.createStatusBarItem('fixture.workbench.status');",
        "  status.show();",
        "  const render = async () => { status.text = 'Config=' + await ctx.workspace.getConfiguration().get('enabled') + ';page=' + (ctx.reader.viewState?.page ?? 'none') + ';zoom=' + (ctx.reader.viewState?.zoom ?? 'none'); };",
        "  await ctx.commands.setContext('fixture.workbench.ready', true);",
        "  ctx.workspace.onDidChangeConfiguration(render);",
        "  ctx.reader.onDidChangeViewState(render);",
        "  ctx.commands.registerCommand('fixture.workbench.ping', () => ctx.window.showInformationMessage('Context command ran'));",
        "  ctx.commands.registerCommand('fixture.workbench.run', async () => {",
        "    const item = await ctx.window.showQuickPick([{id:'one',label:'First item'},{id:'two',label:'Second item'}], {title:'Pick fixture'});",
        "    if (!item) return;",
        "    const value = await ctx.window.showInputBox({title:'Name fixture',value:item.id});",
        "    if (value === undefined) return;",
        "    await ctx.window.withProgress({title:'Progress fixture',cancellable:true}, async (progress,signal) => {",
        "      progress.report({increment:40,message:value});",
        "      await new Promise((resolve,reject) => { const timer=setTimeout(resolve,600); signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Cancelled'));},{once:true}); });",
        "      progress.report({increment:60});",
        "    });",
        "    ctx.window.showInformationMessage('Completed ' + value);",
        "  });",
        "  await render();",
        "}",
      ].join("\n"),
    ),
  };
}
/** Runs through the installed sandbox bridge, not bundled/private host imports. */
export function pdfWorkbenchPackage() {
  const manifest: ExtensionManifest = {
    ...extensionFixtureManifest,
    name: "pdf-workbench",
    displayName: "PDF workbench fixture",
    engines: { cachalot: "^0.1.3" },
    capabilities: ["documents.read", "documents.write", "reader.interact"],
    contributes: {
      commands: [
        {
          command: "fixture.pdf-workbench.build",
          title: "Build PDF comparison",
          enablement: "reader.documentOpen",
        },
        { command: "fixture.pdf-workbench.read", title: "Read retained PDF" },
        { command: "fixture.pdf-workbench.export", title: "Export generated PDF" },
      ],
      menus: [
        {
          location: "reader.toolbar",
          command: "fixture.pdf-workbench.build",
          when: "reader.documentOpen",
        },
      ],
    },
  };
  return {
    manifest,
    buffer: extensionArchive(
      manifest,
      `
    export function activate(ctx) {
      let source, comparison;
      const status = ctx.window.createStatusBarItem('fixture.pdf-workbench.status'); status.text='PDF fixture ready'; status.show();
      ctx.commands.registerCommand('fixture.pdf-workbench.build', async () => {
        await comparison?.close(); await source?.close();
        source = await ctx.documents.openDocument(ctx.reader.activeDocumentId);
        let progress = 0;
        const snapshot = await source.analyze({level:'facts',onProgress:()=>progress++});
        const bytes = await source.readPdf();
        const region = await ctx.pdf.exportRegion(bytes,1,[0,0,0.8,0.5]);
        if(region.contentIsolation !== 'visual-crop') throw new Error('Unexpected crop contract');
        const generated = await ctx.pdf.compose({sources:[bytes],pages:snapshot.facts.map((facts,index)=>index===0
          ? {source:{source:0,page:1}}
          : {width:facts.width,height:facts.height,overlays:[{source:0,page:facts.page}]})});
        await ctx.artifacts.write({id:'derived',name:'derived.pdf',mediaType:'application/pdf',sourceDocumentId:source.document.id,bytes:generated});
        const persisted = await ctx.artifacts.read('derived');
        const pages = await ctx.pdf.inspect(persisted);
        comparison = await ctx.reader.openPdfComparison({id:'fixture.pdf-workbench.compare',documentId:source.document.id,
          artifactId:'derived',title:'Generated PDF fixture',alignment:pages.map(p=>({id:'page'+p.page,original:{page:p.page,box:[0,0,1,1]},derived:[{page:p.page,box:[0,0,1,1]}]}))});
        status.text='PDF ready / '+pages.length+' / '+progress;
      });
      ctx.commands.registerCommand('fixture.pdf-workbench.read',async()=>{
        const bytes=await source.readPdf(); const pages=await ctx.pdf.inspect(bytes);
        ctx.window.showInformationMessage('Retained PDF / '+pages.length);
      });
      ctx.commands.registerCommand('fixture.pdf-workbench.export',async()=>ctx.artifacts.export('derived'));
      return { async artifacts(){return await ctx.artifacts.list();} };
    }
  `,
    ),
  };
}

/** A real Worker consumer reads on every action and refreshes on catalogue changes. */
export function modelsPackage() {
  const manifest: ExtensionManifest = {
    ...extensionFixtureManifest,
    name: "models",
    displayName: "Live models fixture",
    engines: { cachalot: "^0.1.2" },
    capabilities: ["lm"],
    contributes: {
      views: [{ id: "fixture.models.web", title: "Live models", location: "sidebar.right" }],
    },
  };
  return {
    manifest,
    buffer: extensionArchive(
      manifest,
      `
    export function activate(ctx) {
      ctx.window.registerWebviewViewProvider('fixture.models.web', { resolveWebviewView(webview, view) {
        webview.html = '<p id="models">Loading</p><p id="result">Ready</p><button id="refresh">Refresh models</button><button id="call">Use B</button><script>document.getElementById("refresh").onclick=()=>parent.postMessage({kind:"refresh"},"*");document.getElementById("call").onclick=()=>parent.postMessage({kind:"call"},"*");addEventListener("message",e=>document.getElementById(e.data.kind).textContent=e.data.text);</script>';
        const refresh = async () => { const models = await ctx.lm.getModels(); webview.postMessage({kind:'models',text:models.map(m=>m.providerId+'/'+m.modelId).sort().join(',') || 'Empty'}); };
        const events = ctx.lm.onDidChangeModels(refresh);
        const messages = webview.onDidReceiveMessage(async message => {
          if(message.kind==='refresh') await refresh();
          if(message.kind==='call') {
            try { await ctx.lm.complete({providerId:'b',modelId:'shared',messages:[{role:'user',content:'live models test'}]}, delta=>webview.postMessage({kind:'result',text:delta}),view.signal); }
            catch { webview.postMessage({kind:'result',text:'Blocked'}); }
          }
        });
        void refresh();
        return {dispose(){events.dispose();messages.dispose();}};
      }});
      ctx.window.showView('fixture.models.web');
    }
  `,
    ),
  };
}
