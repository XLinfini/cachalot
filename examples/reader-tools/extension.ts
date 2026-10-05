import type { ExtensionContext } from "../../src/sdk";
export function activate(context: ExtensionContext) {
  context.reader.setBackground("#e7eef8");
  context.commands.registerCommand("example.reader-tools.first-page", () => {
    const id = context.reader.activeDocumentId;
    if (id) context.reader.revealPage(id, 1);
  });
  context.window.registerTreeDataProvider("example.reader-tools.pages", {
    getChildren: () => [
      {
        id: "first",
        label: { zh: "回到首页", en: "First page" },
        command: { command: "example.reader-tools.first-page" },
      },
    ],
  });
  context.window.showView("example.reader-tools.pages");
  const status = context.window.createStatusBarItem("example.reader-tools.status", "right");
  status.text = { zh: "阅读工具已就绪", en: "Reader tools ready" };
  status.command = "example.reader-tools.first-page";
  status.show();
  return {
    async describe() {
      return "Reader tools example";
    },
  };
}
