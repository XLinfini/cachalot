# 插件开发与宿主边界

Cachalot 本体是一款理解学术文档的 PDF 阅读器。文献库、PDF 显示、PageFacts、原始 LayoutObservations、DocumentSemantics、来源资源、OCR、公式复建、模型调用和本体 LLM 问答栏由本体提供。选区翻译是首个预装插件，可以停用、不能卸载。

## 包与依赖

公开入口是 `src/sdk/index.ts`，React 可选入口是 `src/sdk/react.tsx`。当前内置插件在 `src/extensions/`，开发安装清单在 `src/application/extensions/runtime.ts`。插件只依赖自己的包、公开 SDK 和外部库，不导入 services、基础设施、核心组件或其他插件。SDK 后续可以独立发布；当前未发布 npm 包，也不扫描用户目录安装任意代码。

每个插件提供 `manifest.ts` 和导出 `activate(context)` 的模块。宿主安装记录提供 `builtIn`、模块加载函数和兼容迁移；插件清单无法自行声明为不可卸载内置插件。清单/上下文命名遵循 VS Code 常见组织方式，但不直接兼容 VS Code 的二进制插件。公开 API 当前版本为 0.1，仅接受 `engines.cachalot: "^0.1.0"`。

```ts
import type { ExtensionManifest } from "../../sdk";
export const manifest: ExtensionManifest = {
  publisher: "example", name: "bookmarks", version: "0.1.0",
  displayName: {zh: "书签", en: "Bookmarks"},
  description: {zh: "记录论文阅读位置", en: "Save reading positions"},
  engines: {cachalot: "^0.1.0"},
  activationEvents: ["onDocumentOpen"],
  capabilities: ["documents.read", "reader.interact"],
  contributes: {
    commands: [{command: "example.bookmarks.reveal", title: {zh: "跳转书签", en: "Reveal bookmark"}}],
    viewsContainers: [{id: "example.bookmarks.container", title: "Bookmarks", location: "sidebar.left"}],
    views: [{id: "example.bookmarks.list", title: {zh: "书签", en: "Bookmarks"}, container: "example.bookmarks.container", location: "sidebar.left"}],
  },
};
```

命令、工具、动作、容器、视图和状态项 ID 以 `publisher.name.` 开头。视图和命令必须在清单声明，重复 ID 或未声明注册会使激活失败并释放先前注册。树视图、Webview、挂载视图共用同一视图位置。`contributes.menus` 可把已声明命令加入 `reader.toolbar`。配置声明提供默认值、标题和说明，由自己的 settings 视图编辑。

## 激活、状态与取消

```ts
import type { ExtensionContext } from "../../sdk";
export function activate(context: ExtensionContext) {
  context.commands.registerCommand("example.bookmarks.reveal", (...args) => {
    const id = context.reader.activeDocumentId;
    if (id) context.reader.revealPage(id, Number(args[0] || 1));
  });
  context.window.registerTreeDataProvider("example.bookmarks.list", {
    getChildren: () => [{
      id: "first-page", label: {zh: "第 1 页", en: "Page 1"},
      command: {command: "example.bookmarks.reveal", arguments: [1]},
    }],
  });
  context.window.showView("example.bookmarks.list");
}
```

`onStartupFinished`、`onDocumentOpen` 和已声明命令的 `onCommand:ID` 激活点已支持。命令调用在需要时加载一次插件。宿主自动收集所有 SDK 返回的 Disposable；手动加入 `context.subscriptions` 也允许，资源释放幂等。停用或激活失败撤销注册、取消请求、释放订阅和文案；再次启用创建新作用域。旧上下文无法继续写状态、注册资源或调用模型。

`context.globalState.get/update` 持久化 JSON，`context.workspace.getConfiguration().get/update` 读写已声明字符串配置，均使用插件命名空间。停用保留数据。不要将凭据存进插件状态；模型调用只提交配置好的服务商/模型 ID，SDK 不提供真实 API Key。

`context.signal` 是整个激活作用域的 AbortSignal。视图另有 `ViewHandle.signal`，关闭或替换视图时取消。OCR 和 LLM 调用可接受更细的请求信号，宿主组合两者并控制流式回调。重试前应取消旧请求。`deactivate()` 可做额外清理，自动注册的资源不依赖它才能释放。

## 公共能力

| 接口 | 用途与边界 |
| --- | --- |
| `documents.getPageFacts/getLayoutObservations/getSemanticPage/getDocumentSemantics` | 获取当前已打开文档的事实、原始观测和语义；返回复制的数据，缺页按需分析。DocumentSemantics 可能部分覆盖，检查 coverage。 |
| `documents.onDidChangeDocument` | 获取新语义快照，不自行拼接第二份权威文档树。 |
| `reader.registerInteractionTool` | 注册矩形工具，preview 提供覆盖框，select 决定完整选取结果；本体处理手势、截图和坐标。 |
| `reader.registerSelectionAction/onDidChangeSelection` | 对通用来源预览注册动作。文字模式传递实际 DOM 字符索引，插件决定业务范围。 |
| `reader.registerHoverProvider` | 基于当前页面投影和归一化点返回悬停文本，可异步并取消。 |
| `reader.setDecorations/setBackground/revealPage` | 提供来源覆盖框、阅读区域背景或导航；资源按插件释放。 |
| `ocr.reconstructFormulas` | 对明确的公式区域取得来源图片和校验候选，复用独立 OCR 选择与兼容缓存。 |
| `formulas.exportPdf` | 原始 PDF 公式矢量资源裁剪。 |
| `lm.activeModel/supportsImages/complete` | 使用本体选择的模型、查询图像能力和流式调用；凭据只由平台注入。 |
| `window.registerViewProvider/registerTreeDataProvider/registerWebviewViewProvider/showView` | 提供自有视图内容，本体控制位置、显示、关闭与实例。 |
| `window.createStatusBarItem` | 左右状态项、优先级、命令；与底部内容 panel 区分。 |
| `localization.registerResources/translate/onDidChangeLanguage` | 插件独立词典与语言变化；Label 对象由工作台翻译。 |

能力声明包括 `documents.read`、`reader.interact`、`reader.decorate`、`ocr`、`lm`。未声明的 SDK 调用被拒绝；文档读取不授予模型调用，模型调用不提供底层命令或凭据。安装清单目前只接纳可信模块，这些声明不是同进程代码的强安全沙箱。

所有 PDF 坐标使用显示页面的归一化 `[left, top, right, bottom]`，与屏幕像素/缩放分离。页面事实与语义不互相改写，OCR 候选不写入语义树。`ReaderSelection` 是本体共享的来源预览，特定业务 DTO 保存在插件内；选区翻译自己的版本绑定、上下文、公式/标题协议见 `selection-translation/types.ts` 和同目录实现。

## 视图实现

`sidebar.left`、`sidebar.right`、`panel` 是本体可调整的工作台区域；`settings` 为设置页；`modal` 是临时覆盖窗口。容器声明用于组织归属，视图在对应区域使用标签呈现。用户可移动侧栏/panel 视图、改变尺寸、关闭或再次展开；偏好由宿主保存。设置视图在设置窗口内切换栏目或语言时保持挂载，保留未保存草稿；离开设置或停用插件时释放。视图内容节点只属于该视图，不允许据此修改本体 DOM。

树视图提供 `getChildren`、可选 `onDidChangeTreeData`，节点包含稳定 ID、Label、description、collapsible 与 command。宿主处理展开、刷新、点击和异步错误。

Webview 提供者接收 `webview.html/postMessage/onDidReceiveMessage`。HTML 在 sandbox iframe 内运行，没有 same-origin、Tauri、文件系统或本体 DOM 权限；顶层导航、弹出窗口和表单提交被禁用，当前文档不能 fetch 或加载外部脚本。iframe 自身导航尚未隔离，不能把此实现当作恶意 HTML 的强网络沙箱。消息只到该视图提供者，提供者再通过已授权 SDK 办事。当前不支持 `asWebviewUri` 文件资源；图片可使用 data URL。不要为展示效果放宽 CSP。

可信打包的 React UI 可使用 `reactView(Component)` 挂载到拥有的内容根节点，组件接收 ViewHandle。`useActiveModel(context)`、`useExtensionTranslation(context)`、`MathMarkdown` 和 ui 样式是可选公共工具，不依赖翻译实现。React 根在释放时销毁；关闭视图不卸载整个插件。Webview 是不依赖 React 的 HTML UI 通道。

## 首个插件与验证

选区翻译注册 region 工具、翻译选区动作、result modal、settings 页面和自己的文案。完整段落/行间公式策略、紫色高亮、精确文字选取、有限背景、OCR 后的翻译编排、标题/公式标记校验、三栏核对与复制都保留；阅读器只看到通用工具、覆盖框、来源预览与注册视图。本体问答栏不随翻译停用。

插件可在阅读器打开之后才完成异步激活。用户尚未选择模式时，本体跟随首个可用工具；用户手动选择文字或其他工具后，后续激活不会覆盖该选择。

`tests/fixtures/extensions.ts` 是第二个 SDK 使用者示例：背景、悬停、树侧栏、Webview panel 和 statusbar。它只由隔离浏览器测试的开发加载器安装，不预装给用户。测试边界和命令见 [测试维护指南](../tests/README.md)。

后续社区发布需要建设独立插件运行时、消息桥、开发工具、安装授权、包资源与签名/分发。当前已经分离 SDK、宿主、工作台和插件包，外部主代码执行环境尚未实现；不要把任意下载的 JavaScript 放入可信加载器。
