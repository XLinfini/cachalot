import type { ExtensionContext, Event } from "cachalot";
interface Bookmark {
  id: string;
  documentId: string;
  page: number;
  label: string;
}
export function activate(context: ExtensionContext) {
  const listeners = new Set<() => void>();
  const changed: Event<void> = (listener) => {
    listeners.add(listener);
    return {
      dispose: () => {
        listeners.delete(listener);
      },
    };
  };
  const refresh = () => {
    for (const listener of listeners) listener();
  };
  const bookmarks = () => context.globalState.get<Bookmark[]>("bookmarks", []);
  context.window.registerTreeDataProvider("example.bookmarks.tree", {
    onDidChangeTreeData: changed,
    async getChildren() {
      return (await bookmarks())
        .filter((item) => item.documentId === context.reader.activeDocumentId)
        .map((item) => ({
          id: item.id,
          label: item.label,
          description: String(item.page),
          command: { command: "example.bookmarks.open", arguments: [item.id] },
        }));
    },
  });
  context.reader.onDidChangeActiveDocument(refresh);
  context.commands.registerCommand("example.bookmarks.add", async () => {
    const state = context.reader.viewState;
    if (!state) return;
    const label = await context.window.showInputBox({
      title: { zh: "书签名称", en: "Bookmark name" },
      value:
        context.localization.language === "zh" ? "第 " + state.page + " 页" : "Page " + state.page,
    });
    if (!label || context.reader.activeDocumentId !== state.documentId) return;
    const values = await bookmarks();
    // Opaque-origin Workers may not expose the secure-context randomUUID helper.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    values.push({ id, documentId: state.documentId, page: state.page, label });
    await context.globalState.update("bookmarks", values);
    refresh();
    context.window.showView("example.bookmarks.tree");
  });
  context.commands.registerCommand("example.bookmarks.open", async (...args) => {
    let bookmark = (await bookmarks()).find((item) => item.id === args[0]);
    if (!bookmark) {
      const values = (await bookmarks()).filter(
        (item) => item.documentId === context.reader.activeDocumentId,
      );
      const selected = await context.window.showQuickPick(
        values.map((item) => ({
          id: item.id,
          label: item.label,
          description: String(item.page),
        })),
        { title: { zh: "跳转到书签", en: "Go to bookmark" } },
      );
      bookmark = values.find((item) => item.id === selected?.id);
    }
    if (bookmark && bookmark.documentId === context.reader.activeDocumentId)
      context.reader.revealPage(bookmark.documentId, bookmark.page);
  });
  return {
    async list(documentId: string) {
      return (await bookmarks()).filter((item) => item.documentId === documentId);
    },
  };
}
