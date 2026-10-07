# 插件 API 参考

[插件开发](../extensions.md) · 版本：0.1.3 · 类型权威：[src/sdk/index.ts](../../src/sdk/index.ts)

本页列出公开接口，不列私有宿主方法。外部插件通过 `activate(context)` 的 context 使用能力；纯工具从 `cachalot` 导入，可信 React 工具另见[视图指南](views.md#内置-react-模块)。

## 通用约定

| 类型 / 约定    | 含义                                                                       |
| -------------- | -------------------------------------------------------------------------- |
| `Disposable`   | `dispose(): void`；SDK 注册自动跟踪，重复释放应无害                        |
| `Event<T>`     | `(listener: (value: T) => void) => Disposable`                             |
| `Label`        | 字符串或 `{zh: string, en: string}`                                        |
| `Box`          | 显示页归一化 `[left, top, right, bottom]`                                  |
| `Capability`   | documents.read、documents.write、reader.interact、reader.decorate、ocr、lm |
| `ViewLocation` | sidebar.left、sidebar.right、panel、settings、modal                        |
| Promise        | 异步数据与完成信号；不能将返回 Promise 当作同步值                          |

社区调用经过消息桥，注册资源句柄可同步返回，但宿主登记确认是异步的，登记错误会使激活或当前作用域失败。所有跨 Worker 公开服务方法按异步方式设计。回调自行处理预期失败，避免留下未处理的 Promise rejection。

本页的“无额外能力”仍要求有效激活作用域、正确的归属与已声明贡献。它不意味着任意系统访问。

## 模块与上下文

| 成员                    | 类型 / 行为                                           |
| ----------------------- | ----------------------------------------------------- |
| `activate(context)`     | 返回 unknown 或 Promise；返回值成为公开 exports       |
| `deactivate?()`         | 可选清理，void 或 Promise；有界等待，不保证长任务完成 |
| `context.extension`     | 只读安装身份 `{id, manifest}`；不能自行更改内置身份   |
| `context.subscriptions` | 注册句柄数组；社区自建资源另用 signal/deactivate 清理 |
| `context.signal`        | 当前激活作用域 AbortSignal                            |

`ExtensionModule.onDidFail` 只供宿主运行适配器使用，不是社区入口应导出的生命周期钩子。停止后的 context 不应继续写状态、注册内容或请求服务，详见[生命周期](lifecycle.md)。

## extensions

| 调用 / 返回成员                                  | 行为                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| `getExtension<T>(id): Extension<T> \| undefined` | 只能查询清单声明的硬依赖；未声明会拒绝                 |
| `Extension.id/manifest`                          | 依赖身份与清单                                         |
| `Extension.isActive`                             | 当前实例是否已激活；消费者正常激活时其硬依赖已成功激活 |
| `Extension.exports: T`                           | 公开服务对象，类型参数不做运行时协议验证               |
| `Extension.activate(): Promise<T>`               | 取得已激活服务，失败会拒绝                             |

更新提供者时消费者一起重载，不继续使用旧 API 代理。跨边界只用普通 JSON 与 Uint8Array，见[依赖示例](lifecycle.md#使用公开-api)。

## globalState、workspace 与 resources

这些接口无额外能力名，作用于自己的插件命名空间或包。

| 接口                                                        | 参数与结果                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------- |
| `globalState.get<T>(key, fallback): Promise<T>`             | 读取 JSON；缺失或无法解析时使用 fallback                                  |
| `globalState.update(key, value): Promise<void>`             | 保存 JSON 可序列化值；不要保存密钥或函数                                  |
| `workspace.getConfiguration()`                              | 返回当前插件的配置读写对象                                                |
| `configuration.get<T = string>(key, fallback?): Promise<T>` | 已声明 key 返回经 schema 校验的值或 default；未知 key 可显式提供 fallback |
| `configuration.update(key, value): Promise<void>`           | 仅更新已声明 key 的 JSON 值，执行类型/enum/范围校验                       |
| `workspace.onDidChangeConfiguration`                        | Event<{key, value}>，仅自己的已提交配置变化                               |
| `resources.read(path): Promise<Uint8Array>`                 | 安全包内相对路径，返回副本；不存在或越界拒绝                              |

当前没有 remove、跨插件配置读写或任意文件系统。旧的无 type 配置仍为字符串；类型与自动设置界面见[配置指南](configuration-and-ui.md)。停用、重启和卸载保留状态/配置；安装代码在独立仓库。资源用法见[打包](packaging.md#资源读取)。

## localization

| 成员                                      | 参数与结果                              |
| ----------------------------------------- | --------------------------------------- |
| `language`                                | 同步只读 `"zh" \| "en"`，随宿主快照更新 |
| `onDidChangeLanguage`                     | Event，每个监听器独立触发和取消         |
| `registerResources({zh, en}): Disposable` | 两个嵌套 Record，注册自己的词典         |
| `translate(key, values?): string`         | 同步翻译；values 为 string/number 字典  |

社区 Worker 镜像支持嵌套键和 `{{name}}` 插值，未找到时返回 key，不提供可信内置模块的本体词典回退或所有 i18next 高级语法。宿主不会自动翻译 Webview HTML。

## commands

| 方法                                            | 参数与结果                                           |
| ----------------------------------------------- | ---------------------------------------------------- |
| `registerCommand(id, handler): Disposable`      | 命令须已声明，handler 接收 unknown[]，可异步返回结果 |
| `executeCommand(id, ...args): Promise<unknown>` | 执行已注册命令，或按 onCommand 激活其声明者          |

`setContext(key, value): Promise<void>` 发布本插件 ID 前缀的 string/number/boolean/null 条件键；停止时清理。executeCommand 同样检查命令 enablement，不只在界面禁用入口。条件与贡献点见[命令指南](commands-and-context.md)。

命令名不是 shell 或 Tauri 名。引用其他插件命令并不等于可查询其 exports；公开服务仍要声明硬依赖。

## window

| 方法                                                            | 参数与结果                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `registerTreeDataProvider(id, provider): Disposable`            | 注册已声明视图的树数据                                                 |
| `registerWebviewViewProvider(id, provider): Disposable`         | 注册已声明视图的 HTML 提供者                                           |
| `registerViewProvider(id, provider): Disposable`                | 直接 mount HTMLElement，仅可信内置模块支持                             |
| `showView(id, data?): void`                                     | 展示本插件已注册视图并创建传入 data 的实例                             |
| `createStatusBarItem(id, alignment?, priority?): StatusBarItem` | 默认 left/0；ID 为本插件前缀                                           |
| `showInformationMessage(message): void`                         | 显示可关闭普通文本通知                                                 |
| `showWarningMessage(message): void`                             | 显示可关闭警告通知                                                     |
| `showQuickPick(items, options?, signal?)`                       | Promise<QuickPickItem 或 undefined>；options 可含 title                |
| `showInputBox(options, signal?)`                                | Promise<string 或 undefined>；title、可选 prompt/value/password        |
| `withProgress<T>(options, task): Promise<T>`                    | options 为 title 与可选 cancellable；task 接收 Progress 和 AbortSignal |
| `showErrorMessage(message): void`                               | 交给宿主显示普通错误文本                                               |

TreeDataProvider：`getChildren(parent?: TreeItem): TreeItem[] | Promise<TreeItem[]>`，可附 `onDidChangeTreeData: Event<void>`。TreeItem 字段为 id、label、可选 description、collapsible、command；command 包含命令 ID 和可选 arguments 数组。

WebviewViewProvider：`resolveWebviewView(webview, view): void | Disposable`，同步返回可选清理。Webview 的 html 是字符串属性，postMessage 返回 void，onDidReceiveMessage 为 Event<unknown>。

ViewHandle：data 为 unknown，signal 为该实例的 AbortSignal，close() 关闭视图。StatusBarItem：text、可选 tooltip 为 Label，command 为可选字符串，show/hide/dispose 返回 void。同侧较高 priority 靠前。

Progress.report({message?, increment?}) 更新增量百分比。用户关闭选择/输入返回 undefined；调用取消或插件停止拒绝 AbortError。进度结束自动清理，task 应响应取消。示例与限额见[公共交互](configuration-and-ui.md)。

位置、草稿、导航边界与完整示例见[视图指南](views.md)。

## documents

全部需要 `documents.read`，页码从 1 开始。原有 get* 便捷方法连接当前阅读器会话；openDocument 创建独立的文献句柄，适用于跨页与后台任务。

| 方法 / 事件                               | 结果与含义                                                                                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `openDocument(documentId, signal?)`       | `Promise<DocumentHandle>`，打开文献库中的已知 ID；不依赖阅读器是否打开                                                       |
| `getPageFacts(documentId, page)`          | `Promise<PageFacts>`，原生事实                                                                                               |
| `getLayoutObservations(documentId, page)` | `Promise<LayoutObservations \| null>`，按需确保该页分析后读取原始预测；分析失败可拒绝，类型允许 null。不是被动的完成状态查询 |
| `getSemanticPage(documentId, page)`       | `Promise<SemanticPageView>`，按需页面投影                                                                                    |
| `getDocumentSemantics(documentId)`        | `Promise<DocumentSemantics>`，当前覆盖的文档快照                                                                             |
| `onDidChangeDocument`                     | `Event<{documentId, semantics}>`，页面补齐后的语义变化                                                                       |

返回复制数据，不作为权威结构回写入口。不能仅由 complete=false 推导“没有任何可用页面”；应查看 coverage，见[文档分析](../document-analysis.md)。

DocumentHandle：只读 document；readPdf(signal?)、getPageFacts(page)、getLayoutObservations(page)、getSemanticPage(page)、getDocumentSemantics()、analyze(options?)、close() 均为 Promise。analyze 的 options 为 level（facts/layout，默认 layout）、signal、onProgress；返回 `{document, level, semantics, facts}`。facts 确保所有页事实，但语义可部分覆盖；layout 确保全文结构覆盖，不完整会拒绝。onProgress 收到 `{phase, completed, total}`。

句柄在关闭标签后仍有效；每次激活最多 8 个，close 可重复调用，停止插件自动释放。打开 signal 只用于打开过程；analyze 取消会关闭自己的句柄及分析资源，重新打开可复用缓存。见[PDF 任务指南](pdf-artifacts-and-comparison.md#独立于阅读器的文档句柄)。

## artifacts

全部需要 `documents.write`，限定本插件的二进制用户数据；与论文缓存分开保存。

| 方法                      | 结果与含义                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `write(input, signal?)`   | `Promise<Artifact>`；input 为 id/name/mediaType/bytes，可选 sourceDocumentId；同 ID 原子替换 |
| `read(id, signal?)`       | `Promise<Uint8Array>`，字节副本                                                              |
| `list(sourceDocumentId?)` | `Promise<Artifact[]>`，只读元数据，可按来源过滤                                              |
| `delete(id)`              | `Promise<void>`；关闭正在使用该产物的比较视图                                                |
| `export(id)`              | `Promise<void>`；本体触发浏览器/Webview 下载                                                 |

Artifact 包含 id、name、mediaType、可选 sourceDocumentId、byteLength、createdAt/updatedAt（毫秒）。单份最多 256 MiB；停用、重启、卸载及清除分析缓存不会删除。完整命名、存储及更新语义见[产物指南](pdf-artifacts-and-comparison.md#保存二进制产物)。

## pdf

| 方法                                      | 能力                             | 结果与约束                                                              |
| ----------------------------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `inspect(bytes, signal?)`                 | documents.read                   | `Promise<PdfPageInfo[]>`，page/width/height；显示页尺寸为 PDF 点        |
| `exportRegion(bytes, page, box, signal?)` | documents.read                   | `Promise<PdfRegion>`，bytes/width/height/contentIsolation；原生可见裁切 |
| `compose(input, signal?)`                 | documents.read + documents.write | `Promise<Uint8Array>`，独立目标 PDF，来源不可变                         |

PdfComposition 为 sources 字节数组和 pages 页计划。每页可有 source `{source, page}`，或省略 source 提供 width/height；可有 removeText: SourceRef[] 与 overlays `{source, page, box?}[]`。source 索引从 0 起，页码从 1 起，box 为目标显示页归一化区域；没有 box 时铺满整页。

移除文字核验内容身份与事实版本，只接受完整顶层文字对象；部分或嵌套对象拒绝，不能把绘制白色遮罩等同内容删除。exportRegion 的 contentIsolation 为 visual-crop，隐藏资源可能保留，不是脱敏操作。计算在独立 Worker 中排队，可取消；不提供文字排版器。两条生成路线、限制与行内公式迁移见[PDF 指南](pdf-artifacts-and-comparison.md)。

## reader

| 成员                                            | 能力                                               | 结果与约束                                                        |
| ----------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `openPdfComparison(options)`                    | documents.read + documents.write + reader.interact | `Promise<PdfComparisonHandle>`；左侧来源，右侧自己的任意 PDF 产物 |
| `getViewStates()`                               | documents.read                                     | `Promise<ReaderViewState[]>`，所有已挂载阅读区域                  |
| `onDidChangePaneState`                          | documents.read                                     | Event<ReaderViewState 或 null>，null 时重新获取当前集合           |
| `activeDocumentId`                              | documents.read                                     | 同步只读 string 或 null                                           |
| `onDidChangeActiveDocument`                     | documents.read                                     | `Event<string \| null>`                                           |
| `viewState`                                     | documents.read                                     | ReaderViewState 或 null，返回副本                                 |
| `onDidChangeViewState`                          | documents.read                                     | Event<ReaderViewState 或 null>                                    |
| `selection`                                     | reader.interact                                    | 同步只读 ReaderSelection 或 null                                  |
| `onDidChangeSelection`                          | reader.interact                                    | `Event<ReaderSelection \| null>`                                  |
| `registerInteractionTool(tool)`                 | reader.interact                                    | Disposable，矩形工具                                              |
| `registerSelectionAction(action)`               | reader.interact                                    | Disposable，通用选区动作                                          |
| `registerHoverProvider(provider)`               | reader.interact                                    | Disposable，页面点的悬停响应                                      |
| `setDecorations(documentId, page, decorations)` | reader.decorate                                    | Disposable，指定页覆盖框注册                                      |
| `setBackground(color)`                          | reader.decorate                                    | Disposable，受支持颜色                                            |
| `revealPage(documentId, page)`                  | reader.interact                                    | void，导航请求                                                    |

ReaderViewState 包含 documentId、page、pageCount、zoom、scrollTop、viewportHeight；后两个为阅读滚动容器的 CSS 像素。新增可选 viewId、anchor `{page, fraction}`、cause（user/navigation）。未挂载、切换/关闭文档时可为 null，事件可随滚动频繁触发；不保证在 activeDocument 事件前已就绪。旧 viewState/onDidChangeViewState 只表示原文，比较视图不改变 activeDocumentId。

PdfComparisonOptions：id（插件前缀）、documentId、artifactId、title，可选 alignment: PdfAlignment[] 和 synchronized。有非空显式 alignment 时默认联动，否则默认不联动。PdfAlignment 为 id、original `{page, box}`、derived `{page, box}[]`，支持一对多。返回句柄有 id、update({alignment?, synchronized?})、reveal(side, anchor)、close()，均异步。

右侧只渲染自身页面和文字层，不进行分析、不继承原文结构、不提供选区翻译；产物可以完全无关。插件停止释放视图和句柄，但不删除产物。使用与生命周期见[并列阅读指南](pdf-artifacts-and-comparison.md#通用并列-pdf-阅读)。

InteractionTool：id、title、可选 tooltip/icon、`mode: "rectangle"`；`preview(page, box)` 返回 ReaderDecoration[] 或 Promise；`select(page, gesture)` 返回 ReaderSelection/null 或 Promise。

SelectionAction：id、title、可选 icon；`when?(selection)` 返回 boolean 或 Promise；`run(selection, signal)` 返回 void 或 Promise<void>。

HoverProvider：`provideHover(page, point, signal)` 返回 Label/null 或 Promise。point 为归一化 `[x,y]`，非屏幕坐标。

ReaderDecoration：id、Box、可选 kind、borderColor、可选 backgroundColor/label。ReaderGesture：documentId、page、Box、imageDataUrl、mode 和可选 text/characterIndices。ReaderSelection 改用 x/y/width/height，并带 text、imageDataUrl 与可选 characterIndices。

注册工具/悬停会收到包含文字的 SemanticPageView。验证范围、迟到响应和精确字符行为见[阅读交互](documents-and-reader.md)。

## lm

全部需要 `lm`。

| 成员                                               | 参数与结果                             |
| -------------------------------------------------- | -------------------------------------- |
| `getModels(): Promise<AvailableModel[]>`           | 每次读取所有提供商最新的已启用模型目录 |
| `onDidChangeModels`                                | `Event<void>`；收到后重新查询目录      |
| `activeModel`                                      | 同步只读 Provider 或 null              |
| `onDidChangeActiveModel`                           | `Event<Provider \| null>`              |
| `supportsImages(model): Promise<boolean>`          | 查询宿主中该具体模型的显式图像能力     |
| `complete(input, onDelta, signal?): Promise<void>` | 流式增量回调，完成不返回拼接字符串     |

CompletionInput：providerId、可选 modelId、messages（role/content）、可选 temperature。请求必须指定已添加且已启用的模型；modelId 省略时仅兼容当前提供商的当前模型，不读取旧默认 ID。上下文由插件组装，凭据由宿主注入，见[模型指南](ai-and-formulas.md)。

AvailableModel：providerId、providerName、modelId、kind（chat/ocr）、supportsImages、可选 formulaOcr。不得长期缓存目录；打开选择界面或开始操作时重新查询，在目录变化时刷新。未启用模型从目录移除，调用时宿主再次检查并拒绝，禁用/删除会撤销其运行请求。

## ocr 与 formulas

| 方法                                         | 能力           | 参数与结果                                                                                                                                 |
| -------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `ocr.reconstructFormulas(formulas, options)` | ocr            | options 包含可选 fallback、supportsImages、model: ModelSelection、signal；显式 model 使用已启用 OCR 模型；返回 `Promise<{assets, issues}>` |
| `formulas.exportPdf(formula)`                | documents.read | 返回 `Promise<Uint8Array>`，原 PDF 公式区域的字节                                                                                          |

FormulaFragment 是当前来源公式投影，包含 documentId、page、Box、块与字符索引、原生文字、候选和 partial 等。FormulaAsset 附原图、像素宽高与 scale；问题 reason 为 request/invalid/characters/vision-unavailable。读取 fallback 模型与能力还需 lm。

OCR 候选不改写语义树，PDF 裁剪不实现全文重排；细节见[公式指南](ai-and-formulas.md#公式复建)。

## 导出的纯工具与数据类型

| 导出                                                      | 用途                                                 |
| --------------------------------------------------------- | ---------------------------------------------------- |
| `selectionPreview(gesture)`                               | 从手势构造共享预览；不自动提取正文或完整段落         |
| `area(box): number`、`intersection(a, b): number`         | 返回面积/交集面积，不返回矩形                        |
| `union(boxes): Box`                                       | 返回包围框；调用方保证非空数组                       |
| `containsCenter(region, box)`                             | 按中心点包含判断，不等于完整单元包含                 |
| `characterText(characters, indices: Set<number>): string` | 按索引重建选中文字，仅补回空白间隔，不补回未选中的词 |
| `message(code, values?)`                                  | 语言无关本体消息编码，不是任意错误传输               |
| `FORMULA_PATTERN`                                         | 既有公式标记的匹配模式，不能单靠它证明翻译协议完整   |

SDK 还重导出 PageFacts、LayoutObservations、ContentBlock、PdfCharacter、FormulaFragment/Asset/PreparationIssue、HeadingLevel、DocumentSemantics、SemanticPageView、SemanticNode、SourceRef、ContentSpan、SemanticFormula、ReaderSelection/Gesture、Provider、CompletionInput 和 DocumentRecord 等 DTO。API 0.1.3 增加 DocumentHandle/Snapshot/AnalysisProgress、Artifact/Input、PdfComposition/PageSource/Overlay/PageInfo/Region、ReaderAnchor、PdfAlignment/ComparisonOptions/ComparisonHandle。结构以源码为准，稳定性与来源版本见[数据契约](../document-analysis.md)。内部类型路径可用于理解实现，不是社区插件额外导入入口。
