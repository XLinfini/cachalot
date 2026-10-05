import type { ExtensionContext, ExtensionManifest, ExtensionModule } from "../../src/sdk";
export const extensionFixtureManifest: ExtensionManifest = {
  publisher: "fixture",
  name: "reader-tools",
  version: "0.1.0",
  displayName: { zh: "测试阅读工具", en: "Fixture reader tools" },
  description: "Fixture only",
  engines: { cachalot: "^0.1.0" },
  activationEvents: ["onStartupFinished"],
  capabilities: ["documents.read", "reader.interact", "reader.decorate"],
  contributes: {
    commands: [{ command: "fixture.reader-tools.navigate", title: "Navigate" }],
    viewsContainers: [
      { id: "fixture.reader-tools.explorer", title: "Explorer", location: "sidebar.left" },
    ],
    views: [
      {
        id: "fixture.reader-tools.tree",
        title: { zh: "测试大纲", en: "Fixture outline" },
        location: "sidebar.left",
        container: "fixture.reader-tools.explorer",
      },
      {
        id: "fixture.reader-tools.web",
        title: { zh: "测试面板", en: "Fixture panel" },
        location: "panel",
      },
    ],
    configuration: [{ key: "theme", title: "Color", default: "#dae8fa" }],
  },
};
export function fixtureExtension(onContext?: (context: ExtensionContext) => void): ExtensionModule {
  return {
    activate(context) {
      onContext?.(context);
      context.reader.setBackground("#dae8fa");
      context.reader.registerHoverProvider({
        provideHover: () => ({ zh: "插件段落摘要", en: "Extension paragraph summary" }),
      });
      context.commands.registerCommand("fixture.reader-tools.navigate", () => {
        const id = context.reader.activeDocumentId;
        if (id) context.reader.revealPage(id, 1);
      });
      context.window.registerTreeDataProvider("fixture.reader-tools.tree", {
        getChildren: () => [
          {
            id: "page-one",
            label: { zh: "第 1 页", en: "Page 1" },
            command: { command: "fixture.reader-tools.navigate" },
          },
        ],
      });
      context.window.registerWebviewViewProvider("fixture.reader-tools.web", {
        resolveWebviewView(webview) {
          webview.html = `<button id="send">Ping host</button><p id="result">Ready</p><script>document.getElementById('send').onclick=()=>parent.postMessage({kind:'ping'},'*');addEventListener('message',event=>document.getElementById('result').textContent=event.data.text)</script>`;
          return webview.onDidReceiveMessage((message) => {
            if ((message as { kind?: string })?.kind === "ping")
              webview.postMessage({ text: "Host replied" });
          });
        },
      });
      context.window.showView("fixture.reader-tools.tree");
      context.window.showView("fixture.reader-tools.web");
      const status = context.window.createStatusBarItem("fixture.reader-tools.status", "right", 10);
      status.text = { zh: "插件已就绪", en: "Extension ready" };
      status.command = "fixture.reader-tools.navigate";
      status.show();
    },
  };
}
