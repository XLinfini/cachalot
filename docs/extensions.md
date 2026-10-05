# 插件开发与宿主边界

Cachalot 本体是一款理解学术文档的 PDF 阅读器。文献库、PDF 显示、PageFacts、原始 LayoutObservations、DocumentSemantics、来源资源、OCR、公式复建、模型调用和本体 LLM 问答栏由本体提供。选区翻译是首个预装插件，可以停用、不能卸载。

## 包与依赖

公开入口是 `src/sdk/index.ts`，React 可选入口是 `src/sdk/react.tsx`。当前内置插件在 `src/extensions/`，内置安装清单在 `src/application/extensions/runtime.ts`，社区插件安装目录单独持久化。插件只依赖自己的包、公开 SDK 和外部库，不导入 services、基础设施、核心组件或其他插件。SDK 后续可以独立发布；当前未发布 npm 包。设置 → 插件支持本地 `.cachx` / ZIP 包，可一次选择多个包补齐依赖。外部包不会进入可信模块加载器。

内置插件提供 `manifest.ts` 和导出 `activate(context)` 的模块；社区插件提供 `package.json` 和打包入口。宿主安装记录提供 `builtIn`、模块加载函数和兼容迁移；插件清单无法自行声明为不可卸载内置插件。清单/上下文命名遵循 VS Code 常见组织方式，但不直接兼容 VS Code 的二进制插件。公开 API 当前版本为 0.1.0，`engines.cachalot` 使用 SemVer 范围，并必须包含宿主版本（禁止完全通配的 `*`）。版本、依赖 ID、贡献声明、激活事件、包内路径均在执行代码之前校验。

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
| `reader.registerInteractionTool` | 注册矩形工具，preview 提供覆盖框，select 决定完整选取结果；可返回 Promise，本体屏蔽迟到手势结果。 |
| `reader.registerSelectionAction/onDidChangeSelection` | 对通用来源预览注册动作。文字模式传递实际 DOM 字符索引，插件决定业务范围。 |
| `reader.registerHoverProvider` | 基于当前页面投影和归一化点返回悬停文本，可异步并取消。 |
| `reader.setDecorations/setBackground/revealPage` | 提供来源覆盖框、阅读区域背景或导航；资源按插件释放。 |
| `ocr.reconstructFormulas` | 对明确的公式区域取得来源图片和校验候选，复用独立 OCR 选择与兼容缓存。 |
| `formulas.exportPdf` | 原始 PDF 公式矢量资源裁剪。 |
| `lm.activeModel/supportsImages/complete` | 使用本体选择的模型、查询图像能力和流式调用；凭据只由平台注入。 |
| `window.registerViewProvider/registerTreeDataProvider/registerWebviewViewProvider/showView` | 提供自有视图内容，本体控制位置、显示、关闭与实例。 |
| `window.createStatusBarItem` | 左右状态项、优先级、命令；与底部内容 panel 区分。 |
| `localization.registerResources/translate/onDidChangeLanguage` | 插件独立词典与语言变化；Label 对象由工作台翻译。 |

能力声明包括 `documents.read`、`reader.interact`、`reader.decorate`、`ocr`、`lm`。未声明的 SDK 调用被拒绝；文档读取不授予模型调用，模型调用不提供底层命令或凭据。内置模块仍在可信进程内运行；安装包在独立 Worker 中运行，通过限定消息桥访问相同的能力检查，不接触本体 DOM、Tauri、真实 Key 或任意文件路径。能力声明也不代替用户对发布者的信任。

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

## 本地安装、更新与重启

设置 → 插件 → 从插件包安装，支持多选。安装预览显示 ID、版本变化、权限、依赖和受影响的运行插件；缺少依赖时补充相应本地包，循环依赖或覆盖内置插件会阻止提交。所有包先校验，之后在一个 IndexedDB 事务中写入；检查失败不会改变安装目录。`cachalot-extensions/packages` 是用户安装数据，在 Tauri Webview 和浏览器均持久化，不属于可清理的论文缓存。卸载只移除代码，保留命名空间内的设置和状态。

安装后按当前激活事件加载插件；更新按依赖顺序停止消费者和提供者，然后加载新作用域。失败的激活显示错误并释放部分注册，已安装包保留以便修复、更新或卸载。安装不会执行 npm scripts、修改本体文件、刷新页面或重启 Tauri。重启单个插件同时重启依赖它的插件；“重启插件宿主”重载全部启用插件，配置、数据和本体服务继续存在。设置页面覆盖并保留阅读工作区，阅读/分析会话、页码、缩放、本体聊天请求不随安装页面的打开或插件重启而卸载。

第一版仅离线本地安装；没有市场、在线自动下载、签名验证或自动升级。SHA-256 用于记录包内容，不能证明发布者身份。

## 依赖与插件 API

采用 [VS Code 清单](https://code.visualstudio.com/api/references/extension-manifest) 的两种声明：

- `extensionDependencies: ["publisher.provider"]` 是硬依赖。宿主在消费者激活前激活全部传递依赖，共享依赖只激活一次。缺失、停用、循环或激活失败会阻止消费者，不影响无关插件。缺失依赖安装完成后会重试已请求激活的消费者。
- `extensionPack: ["publisher.member"]` 是安装组合。选择组合包时一并提供成员包；成员不是运行依赖，停用/卸载组合不会停用/卸载成员。只有提供 `extensionPack` 的组合包可以省略 `main`。

两种声明都使用插件 ID，不混用 npm 依赖，也不在 ID 后拼版本范围；版本兼容范围由 `engines.cachalot` 控制。当前不额外支持依赖插件的版本约束，与 VS Code 的 ID 数组组织一致。插件作者应版本化公开 API。

停用提供者前列出启用中的消费者，由用户选择一起停用；启用消费者时一起启用所需的已安装依赖。卸载提供者前列出全部已安装消费者（包括停用的消费者），可一起卸载；若其中包含内置插件则拒绝卸载。后台 Worker 崩溃或无响应时释放它及消费者的作用域，消费者显示依赖失败，可通过重启插件或安装修复包恢复。

与 [VS Code API](https://code.visualstudio.com/api/references/vscode-api#extensions) 一样，`activate` 的返回值是公开 API，只能通过已声明硬依赖的 `context.extensions.getExtension(id).exports` / `.activate()` 使用，不导入其他插件源码：

```ts
// Provider
export function activate(context: ExtensionContext) {
  return { async describe(documentId: string) { return "..."; } };
}
// Consumer: package.json declares extensionDependencies: ["example.provider"]
export async function activate(context: ExtensionContext) {
  const api = await context.extensions.getExtension<{
    describe(documentId: string): Promise<string>;
  }>("example.provider")!.activate();
  const description = await api.describe("current-document");
}
```

跨 Worker 的 API 由消息桥代理；方法必须按异步方式使用，数据使用普通 JSON 对象/数组和 Uint8Array，不传递 DOM、类实例、Map/Set 或共享可变对象。更新提供者时重启消费者，使其取得新 API，不继续持有旧代理。

## 打包与社区执行环境

完整示例在 [examples/reader-tools](../examples/reader-tools/README.md)：

```sh
npm run extension:pack -- examples/reader-tools /tmp/example.reader-tools.cachx
```

开发目录的 `package.json` 使用上述清单字段，`main` 指向 TypeScript/JavaScript 入口，可用 `files` 列出附带资源文件或目录。打包器使用 esbuild 将依赖和 SDK 工具函数合并为浏览器 IIFE，导出 `cachalotExtension.activate`，将包内入口改为 `extension.js`，生成 ZIP 格式的 `.cachx`。独立工程可以导入 `cachalot`（打包器识别），SDK 尚未发布 npm 包；类型开发可参照示例使用仓库 SDK。不打包 node_modules，不允许 Node 原生模块、外部运行时 import、符号链接或安装脚本。

ZIP 根目录包含 `package.json`、入口和资源文件。限制：压缩包 16 MiB、单文件 8 MiB、展开合计 32 MiB、最多 128 个文件、清单 128 KiB。检查路径穿越、重复条目、加密、跨卷/ZIP64、符号链接、局部头与目录不一致、实际展开长度和 CRC。解析在可终止的独立 Worker 内执行。插件用 `context.resources.read("assets/note.txt")` 取得包内 Uint8Array；图片可编码为 data URL 放进 Webview，不可访问任意宿主文件。

每次激活创建一个 opaque-origin sandbox iframe，iframe 只包含可信启动器；插件主代码在其创建的独立 Blob Worker 中运行，继承禁止外部脚本/网络的 CSP。主代码没有 DOM、本体 origin 存储或 Tauri 桥。宿主只接收明确列出的 SDK 操作并检查能力和归属；消息、注册数、激活时间有界，心跳检测无响应 Worker，终止整个实例即可解除卡死。释放 SDK 注册与中断请求由宿主保证，正常停止会调用 `deactivate`，最多等待 250 ms 后终止 Worker；插件自行启动的后台任务不会获得完成保证。

安装插件使用树视图或 Webview UI，不能通过 `registerViewProvider` 取得本体 HTMLElement，也不能导入可信 `cachalot/react` 挂载工具。可把自己的 React 等库打包到 Webview HTML。工具 preview/select、动作 when、悬停和树数据允许异步返回，消息桥实现相同 SDK，页面更新带代次检查。插件事件和只读模型/文档/选区快照跟随本体变化，LLM 流式回调、每视图 AbortSignal 通过消息桥传递。

这是浏览器运行时隔离，不是操作系统资源配额或恶意代码防护的完整保证。Webview HTML 沿用前述导航限制；仍只安装可信来源的包。当前浏览器回归覆盖 Chromium 的 Blob Worker/CSP/存储隔离；桌面 WebKit 平台应另做实际打包验证。
