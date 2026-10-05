# 视图与工作台

[插件开发](../extensions.md) · 相关：[清单](manifest.md)、[交互设计](ux-guidelines.md)

先选择视图位置，再选择提供者。社区插件用 Tree 或 Webview；直接 HTMLElement/React 挂载只用于可信内置模块。

## 位置与归属

| location        | 用途                     | 行为                         |
| --------------- | ------------------------ | ---------------------------- |
| `sidebar.left`  | 导航、书签、结构列表     | 可移动、调整尺寸、关闭与展开 |
| `sidebar.right` | 与正文相关的辅助内容     | 同上；与本体问答区域区分     |
| `panel`         | 多行结果、日志、结构核对 | 底部内容区，可移动到侧栏     |
| `settings`      | 插件自己的配置编辑       | 设置窗口内的独立栏目         |
| `modal`         | 用户发起操作的临时结果   | 覆盖视图，关闭取消该实例     |

容器可组织归属，视图通过标签切换；当前不提供完整 VS Code Activity Bar。用户的工作台位置与尺寸偏好由宿主保存。

## 命令与菜单

清单用 `contributes.commands` 声明命令，在 activate 中注册处理函数。可以将同一命令加入 `contributes.menus` 的 `reader.toolbar`，也可由树节点或状态项引用。

```ts
import type { ExtensionContext } from "cachalot";

export function activate(context: ExtensionContext) {
  context.commands.registerCommand("example.tools.first-page", () => {
    const documentId = context.reader.activeDocumentId;
    if (documentId) context.reader.revealPage(documentId, 1);
  });
}
```

该命令的清单需声明 `documents.read`、`reader.interact` 与匹配的 command ID。`executeCommand` 返回 Promise，可调用已声明的命令激活入口；它不是任意系统命令接口。当前没有通用命令面板或任意快捷键贡献点。

## 树视图

TreeDataProvider 适合层级导航，宿主负责异步加载、展开、错误和命令点击。节点 `id` 稳定，`collapsible: true` 表示可展开；`getChildren` 的 parent 为 undefined 时加载根。

```ts
import type { ExtensionContext, Event } from "cachalot";

export function activate(context: ExtensionContext) {
  const listeners = new Set<() => void>();
  const onDidChangeTreeData: Event<void> = (listener) => {
    listeners.add(listener);
    return {
      dispose: () => {
        listeners.delete(listener);
      },
    };
  };
  context.window.registerTreeDataProvider("example.outline.tree", {
    onDidChangeTreeData,
    getChildren: (parent) =>
      parent
        ? []
        : [
            {
              id: "first",
              label: { zh: "首页", en: "First page" },
            },
          ],
  });
  context.window.showView("example.outline.tree");
  return {
    async refresh() {
      for (const listener of listeners) listener();
    },
  };
}
```

清单要声明该 view 和激活事件。数据变化后触发 `Event<void>`，当前是整棵树刷新，不使用 VS Code 的 TreeItem 类或增量节点事件。父子节点都应使用稳定且在相关集合中唯一的 ID。

## Webview 与消息

WebviewViewProvider 提供 HTML UI。HTML 通过 `parent.postMessage` 发消息，提供者使用 SDK 处理，并用 `webview.postMessage` 回复。没有 `acquireVsCodeApi`。

```ts
import type { ExtensionContext } from "cachalot";

export function activate(context: ExtensionContext) {
  context.localization.registerResources({
    zh: { ping: "联系宿主", ready: "已就绪", reply: "宿主已回复" },
    en: { ping: "Ping host", ready: "Ready", reply: "Host replied" },
  });
  context.window.registerWebviewViewProvider("example.panel.web", {
    resolveWebviewView(webview, view) {
      const render = () => {
        const ping = context.localization.translate("ping");
        const ready = context.localization.translate("ready");
        webview.html = `<!doctype html><html><body>
          <button id="ping">${ping}</button><p id="reply">${ready}</p>
          <script>
            document.getElementById('ping').onclick = () => parent.postMessage({type:'ping'}, '*');
            addEventListener('message', event => {
              if (event.source === parent && event.data && event.data.type === 'reply')
                document.getElementById('reply').textContent = event.data.text;
            });
          </script>
        </body></html>`;
      };
      render();
      const language = context.localization.onDidChangeLanguage(render);
      const messages = webview.onDidReceiveMessage((message) => {
        if (view.signal.aborted || !message || typeof message !== "object") return;
        if ("type" in message && message.type === "ping")
          webview.postMessage({ type: "reply", text: context.localization.translate("reply") });
      });
      return {
        dispose() {
          language.dispose();
          messages.dispose();
        },
      };
    },
  });
  context.window.showView("example.panel.web");
}
```

上例只展示消息与双语标签；切换语言会重建 HTML。真实输入表单应通过消息更新标签、保留草稿，来自论文或模型的动态内容须转义。提供者本身同步返回清理句柄；在内部发起异步请求时传 `view.signal`，不要假定 `resolveWebviewView` 的异步 Disposable 会被自动等待。

HTML 在无 same-origin 的 sandbox iframe 中执行，禁止顶层导航、弹窗、表单提交、当前文档 fetch 与外部脚本。包图片可读取后编码成 data URL；当前无 `asWebviewUri`。iframe 自身导航尚未作为强网络隔离实现，不能把这当作恶意 HTML 的完全防护。

将模型输出或论文文字写进 HTML 时使用转义或 `textContent`，不要拼接成可执行脚本。接收消息要验证类型、字段和长度，Worker 能力检查不能替代视图协议验证。

## 视图实例与取消

`window.showView(id, data)` 展示自己的已注册视图，并为新实例传入 data。`ViewHandle` 有 `data`、`signal`、`close()`；关闭或替换实例会取消旧 signal。

设置视图在同一设置窗口内切换栏目或语言时保持挂载，便于保存未提交草稿；离开设置或停用插件时释放。关闭侧栏或 panel 不卸载整插件，重新打开应能创建新视图实例。

## 状态栏

`createStatusBarItem(id, alignment?, priority?)` 返回状态项；默认左侧、优先级 0，同侧较高优先级靠前。修改 text、tooltip、command，再调用 show/hide；ID 使用插件前缀，无需 view 声明。标签可用 `{zh, en}`。

statusbar 是短状态行，不是底部 panel，也不适合长篇摘要或持续错误堆栈。更复杂内容使用视图，见[交互设计约定](ux-guidelines.md)。

## 内置 React 模块

可信内置模块可用 `cachalot/react` 对应的仓库工具 `reactView`、`useActiveModel`、`useExtensionTranslation` 与 `MathMarkdown`。挂载只拥有本视图内容根；关闭时销毁 React 根。社区安装包禁止这个入口，应将自己的 UI 放进 Webview，而不是导入本体组件。
