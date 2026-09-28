# 开发交接：解析、应用服务与界面

## 分层与入口

这是本地应用：业务服务以 TypeScript 接口提供，桌面存储与网络由 Rust/Tauri 承接。浏览器预览使用同一业务服务和同一分析 Worker，只替换存储及网络适配器。当前没有独立 HTTP 服务进程。

| 目录 / 文件 | 职责 | 界面重构时的处理 |
| --- | --- | --- |
| `src/domain/` | 文档、会话、版面 DTO；坐标和模型版本约定 | 复用数据契约，保持无 React / Tauri 依赖 |
| `src/application/services.ts` | 文献库、设置、模型服务、会话、解析、翻译、问答的统一入口 | 新界面调用这里 |
| `src/application/document-analysis.ts` | 文档分析生命周期、缓存读取、逐页续解析 | 在打开/关闭文档时建立/释放 session |
| `src/application/assemble-page.ts` | 检测区域与字符的归属、阅读顺序、图表说明关联 | 业务规则修改后更新缓存版本 |
| `src/application/select-region.ts` | 框选命中与正文提取 | 用归一化选区调用 |
| `src/application/paper-assistant.ts` | 论文检索、上下文与模型请求组装 | 提供输入 DTO 和流式回调 |
| `src/application/model-catalog.ts` | 已添加模型配置、临时模型列表请求、逐模型图像能力 | 通过 services 获取，能力不按模型名称猜测 |
| `src/infrastructure/pdf/document-preview.ts` | 独立生成并缓存 PDF 第一页预览 | 通过 services.library.preview 调用 |
| `src/infrastructure/analysis/` | PDFium、ONNX、Worker RPC、缓存适配器 | UI 不直接访问 |
| `src/infrastructure/platform.ts` | 桌面命令与浏览器持久化/网络适配器 | UI 不直接访问 |
| `src-tauri/src/` | SQLite、PDF 文件、密钥库、模型 HTTP 请求 | 可独立演进；命令参数与 DTO 保持一致 |
| `src/hooks/useDocumentAnalysis.ts` | 服务与 React 生命周期的衔接 | 换框架时替换该桥接层 |
| `src/components/`、`src/App.tsx`、`src/styles/` | 页面、视图状态、PDF.js 显示、操作事件 | 可重新设计 |

## 文献分类

`services.categories.list/create/remove` 管理自建分类，`services.library.move(id, categoryId)` 修改归属，`null` 表示未分类。`DocumentRecord.categoryId` 是可选的兼容字段；旧文献自动归入未分类。每篇论文只归属一个普通分类，“我的收藏”按既有 `starred` 标记汇集论文，收藏和移动互不影响。“全部文献”不按分类或收藏过滤。

桌面通过 `categories.rs` 创建 `categories` 表，幂等迁移添加 `documents.category_id` 外键，使用 `ON DELETE SET NULL` 在同一事务中解除归属。浏览器的 `browser-categories.ts` 在单个 `cachalot:categories` localStorage 记录中保存名称及归属映射，删除分类用一次写入完成；它不修改 PDF、对话或分析缓存。内置分类没有持久化记录或删除入口，适配器也拒绝删除不存在的分类。名称去除两端空白、限制 80 个字符，拒绝大小写重复名称及内置分类的中英文名称。

`CategorySidebar`、`LibraryDocumentCard` 和 `CategoryDialogs` 负责展示和事件；弹窗和三点菜单分别使用 `ui/Modal` 与 `ui/ActionMenu`。菜单通过 portal 避免卡片、滚动侧栏裁切，支持键盘和点击外部关闭。界面重构时保留服务契约即可。分类存储测试：`npm run test:categories`；原生迁移及删除保全测试：`cd src-tauri && cargo test --lib categories`；中英文完整交互：先运行 `test:paper`，启动预览后运行 `npm run test:category-ui -- /absolute/path/reference.pdf`。

## 文献排序

`domain/library-sort.ts` 定义名称及导入时间的升序/降序比较，默认按首次导入时间由新到旧。导入时间使用 `createdAt`，与阅读活动的 `updatedAt` 分开；名称使用当前 UI locale 的 `Intl.Collator`，支持数字自然排序。同值用名称和文献 ID 确定顺序，排序不修改存储记录。搜索和分类先过滤，再使用相同排序偏好。

`LibrarySortMenu` 是受控菜单；App 通过 `services.settings` 保存 `librarySort` 后更新界面，浏览器与桌面沿用各自现有设置存储。非法或缺失偏好回退到默认。菜单复用 `ActionMenu` 的定位、关闭及键盘交互，选择项使用 `menuitemradio`。验证：`npm run test:library-sort`；启动预览后运行 `npm run test:library-sort-ui`，覆盖中英文、四种顺序、刷新恢复、分类和搜索。

## API 密钥显示与编辑

设置中的 `ApiKeyField.tsx` 将密钥显示和编辑草稿分开：`services.providers.keyPreview` 只返回前缀与末四位遮罩，点击眼睛才通过 `revealKey` 读取完整密钥；切换提供商、保存或退出设置都会恢复隐藏。只有实际输入才更新 `ProviderInput.apiKey`，留空保存保留现有密钥。桌面适配器从系统密钥库读取；浏览器适配器 `browser-provider-keys.ts` 使用 AES-GCM 加密后写入 IndexedDB，同时保存不可导出的 Web Crypto 密钥，不向 localStorage 写入原始凭据。浏览器存储属于当前 origin，同源脚本仍可使用加密密钥；它不具备系统密钥库的隔离能力。

浏览器密钥保存等待 IndexedDB 事务提交后才返回成功；存储失败会显示错误，不回退到内存。刷新、热更新整页重载及浏览器重启均可恢复；清除站点数据、隐私会话结束或更换域名/端口会使用不同存储。旧版仅存内存的密钥在重载后无法迁移，需重新输入一次。

服务商 HTTP / SSE 错误通过语言无关消息返回界面，保留 JSON、纯文本或 HTML 错误正文及请求 ID。浏览器与 Rust 使用共享错误样例验证；正文作为普通文本显示，隐藏凭据和图像数据，最多显示 16,384 个字符。

`domain/api-endpoint.ts` 同时供浏览器请求和设置的“实际请求地址”预览使用：只有域名时默认 `/v1`，已有 API 基础路径保持不变，完整 `/chat/completions` 或 `/models` 地址先还原为基础路径再拼接。保留查询参数，移除 fragment。Rust 的 `ai::endpoint` 使用同一规则；`tests/fixtures/api-endpoints.json` 是两端共享的契约测试数据，修改规则时需同步两端。

## 文档分析流程

1. 导入时计算 PDF 内容 SHA-256，作为文档 ID；同一文件重复导入会复用文档。PDF.js 读取目录、元数据和页数。
2. 打开文档，应用服务先按页读取分析缓存。缺失时启动独立 Worker，在 PDFium 中打开论文。
3. PDFium 提取字符（Unicode、字号、字形边界）和顶层页面对象（文字、路径、位图、表单等）。首先建立全部页的文字索引，问答可以先使用这份索引。
4. 每个未分析页面由 PDFium 渲染为 640×640 RGB 图像，送入固定版本 Docling Heron ONNX，得到正文、标题、图、表、公式、说明等区域。
5. 程序将字符按中心点归属到区域，保留模型漏掉的字符为 `confidence: 0` 的待核对块；建立阅读顺序和图表说明关系。区域类型来自模型，PDF 路径对象本身不直接等于一张图。
6. 每页成功写入持久缓存后才视为完成。保存结构结果，同时更新问答的页面文字索引。关闭文档终止 Worker，释放文档句柄和模型内存。

本次接入的是 **Docling 的 Heron 版面模型 + 自己的 PDFium/TypeScript 后处理**。其输出是 Cachalot 的 `PageAnalysis`，与完整 Python Docling 管线的 `DoclingDocument` 格式不同。

## 固定模型与资源

配置唯一来源：`src/domain/model.ts`。

- Heron ONNX：固定提交 `40bde044036bb181c130ddf6c51792187268748f`，FP32，171,220,471 字节。
- SHA-256：`59c81a3a2923042d85034ffc487f8f47e4854117e879aef89b2b9f728fb4922a`。
- PDFium 包：`@embedpdf/pdfium@2.15.1`；ONNX Runtime Web：`1.30.0`。
- 所有平台使用同一份权重、输入尺寸和阈值 0.45，WASM CPU 单线程推理。单线程避免要求 SharedArrayBuffer，实际 iPad 性能与内存仍需真机验证。
- 输入：`images: uint8[1,3,640,640]`，RGB/CHW；`orig_target_sizes: int64[1,2]`，顺序为高、宽。图内已经包含归一化和检测后处理，适配器不再做二次归一化。
- 输出：`labels: int64[1,300]`、`boxes: float32[1,300,4]`（XYXY）、`scores: float32[1,300]`。

`npm run models:prepare` 下载并核对大小和摘要；`npm run build` 首先离线校验模型。模型由 `public/models/` 随应用打包，运行时仅访问本地资源并再次核对摘要，解析不需要 API Key。模型大文件忽略 Git，构建机需要准备一次。第三方许可位于 `public/licenses/`，随构建产物分发。

## 数据与坐标契约

`PageAnalysis` 保存文档 ID、页码、页尺寸、字符、PDF 对象、语义块、阅读顺序、正文和核对提示。完整字段定义见 `src/domain/analysis.ts`。

```ts
// 示例仅展示结构，坐标及文字为示意数据。
{
  schemaVersion: 1, documentId: "PDF内容摘要", page: 1,
  cacheKey: "包含解析器/模型摘要/后处理版本的键",
  width: 612, height: 792,
  characters: [{ index: 0, text: "A", box: [0.1, 0.2, 0.11, 0.22], fontSize: 10, generated: false }],
  objects: [{ id: 8, kind: "path", box: [0.1, 0.5, 0.4, 0.7] }],
  blocks: [{ id: "p1-b0", kind: "figure", box: [0.1, 0.5, 0.4, 0.7], confidence: 0.98,
    characterIndices: [], objectIds: [8], text: "", captionId: "p1-b1" }],
  readingOrder: ["p1-b0", "p1-b1"], plainText: "…", warnings: [], analyzedAt: 0
}
```

- 页码从 **1** 开始；字符和对象索引从 **0** 开始，仅在该 PDF 页内有效。块 ID 随解析版本变化，跨版本引用应保留页码和坐标。
- `Box` 是 `[左, 上, 右, 下]`，坐标范围 0–1，以显示页左上角为原点，包含 PDF 固有旋转。PDFium 的页面到设备转换处理旋转和 CropBox。不要把 CSS 像素、屏幕 DPI、缩放比例写进缓存。
- `width/height` 为 PDF 页尺寸；显示坐标乘 PDF.js 实际 viewport 宽高。图层、框选、截图都应使用同一个 viewport。
- `SelectedRegion` 使用归一化 `x/y/width/height`，临时截图与命中的块 ID。截图当前从 PDF.js 显示画布精确裁剪。
- 框选以**字形中心点**判断命中。用户只选中半行/半个词时，只取命中的字符，不自动补全整行或整个 PDF 文本对象。空白会恢复，未选中的词不会补回。
- 图、表内部文字保留在所属块内，框选正文提取时跳过。独立公式保留为原始区域，行内公式与正文交错保存；翻译输入通过稳定公式标记保留位置。文字模式使用各个 DOM Range 矩形命中的字形，避免把多行选区外侧的文字吸入选区。
- 复合图同时命中整图和子图时，子图通过 `parentId` 关联外层图。后续重排/裁剪应选择外层区域，避免重复显示；这是几何包含关系推断。
- 双栏阅读顺序采用整页宽内容分带、横向空白分栏的启发式规则，复杂版面需要核对。表格尚未解析为行列单元格。公式的 LaTeX 候选不能替代原始 PDF 外观。

## 连续阅读视图

- `src/components/PdfReader.tsx` 管理文档加载、连续滚动、页码同步和导航。滚动使用浏览器原生行为；所有页按各自实际尺寸排列，不将滚轮事件转换为整页跳转。
- `src/components/pdf/page-layout.ts` 计算显示尺寸与页面纵向位置，并在缩放时保持视口上部阅读位置对应的页内比例。页码随视口上部的阅读位置更新，到文档底部时显示最后一页。
- `src/components/pdf/PdfPageView.tsx` 管理单页画布、文字层、版面标注及选区。IntersectionObserver 仅保留视口附近的高清画布和文字层，远页保留尺寸占位并释放渲染资源；混合页尺寸和旋转按 PDF.js viewport 排列。
- `useDocumentAnalysis` 仍只创建一个文档解析 session，向各页提供缓存分析，不为每个显示组件重复初始化模型。
- 框选与截图固定使用实际选中的页，滚动至其他页不会改变已选内容的来源。文字模式允许跨页复制；翻译选区目前限单页，跨页时显示提示。
- 当前持久保存阅读页码，重开时定位到该页开头；尚未保存页内滚动偏移。缩放时的页内位置保持仅用于当前视图。

## 缓存与恢复

桌面：SQLite `page_analysis(document_id, cache_key, page, content)`；浏览器：IndexedDB `cachalot-analysis/pages`，联合键相同。原生提取与完整语义分析分别存储。写入完成按 SQLite 提交或 IndexedDB transaction complete 判断；模型分析报错不覆盖此前成功页。

- 完整页缓存命中时跳过 PDFium 和 ONNX 加载/推理。
- 中断后重新打开，只处理当前版本缺失的页。
- 缓存键包含 schema、PDFium 包版本、模型 SHA、规则版本、阈值。换模型、坐标、字符归属、阅读顺序或阈值时必须更新相应键，旧缓存不复用。
- 删除论文时清理 PDF、页面文字、分析和会话；桌面通过外键级联，浏览器通过服务协调。浏览器站点数据被系统/用户清理后需要重新导入及分析。
- 当前尚未提供自动清理旧模型版本缓存的维护界面。

## 模型选择与问答图片

- `ModelPicker.tsx` 将提供商和模型组合成单一选择，位于发送键左侧、向上展开。选择保存在 `activeModel` 设置，包含 `providerId/modelId`；不会覆盖模型服务配置里的默认模型。`CompletionInput.modelId` 经浏览器和 Tauri 两个网络适配器传入请求。
- 模型菜单直接展示应用配置 `Provider.addedModels`，不维护列表、不读取完整目录缓存、不发送 `/models` 请求。`services.providers.list/save` 使用统一的 `addedModels:<providerId>` 设置（桌面 SQLite / 浏览器 localStorage），作为已添加列表的唯一持久来源。服务商可选列表只在设置抽屉中临时显示，获取列表本身不会添加模型。支持从列表添加多个模型、移除、手动保存默认 ID；旧版仅将原默认 ID 视为已添加。移除当前聊天模型会清除该选择并使用剩余默认模型，历史消息保留。
- 图像能力按 `vision:model:<providerId>:<编码后的modelId>` 保存。旧的 `vision:<providerId>` 只兼容配置中的默认模型。每次请求根据当前模型重新计算能力，禁止把同一提供商的所有模型视作图像模型。
- `ChatComposer.tsx` 复用 assistant-ui 附件机制。切换模型时保持附件适配器和草稿；含图片的草稿遇到文字模型时，禁用发送按钮并拦截回车提交。用户可移除图片或切回图像模型。
- `ChatMessage.images` 保存原图、文件名和 MIME 类型。桌面 SQLite 的 `chat_messages.images` 存为 JSON；启动时幂等迁移旧数据库，旧消息默认为空数组。浏览器图片存于 `cachalot-chat-images/images` IndexedDB，localStorage 仅保存图片元数据，删除消息、会话和论文时同步清理。
- 请求组装位于 `paper-assistant.ts`：图像模型接收 `image_url`；文字模型的历史上下文改用文字标记说明此前有图片，不发送图片载荷。原始会话记录不修改，切回图像模型可重新使用原图；当前问题携带不兼容图片时由服务层再次拒绝。
- 首页预览由 PDF.js 独立渲染，无需 Docling/PDFium。串行生成、按可见卡片懒加载，预览上限 260×320 像素；缓存版本为 `preview:v1`，桌面存于 SQLite 设置，浏览器存于 `cachalot-previews/previews` IndexedDB。删除论文会清理预览。

## 公式定位、语义与保真

1. PDFium 提取字形 Unicode、原始字号、字体、字形原点及文字矩阵。`emSize` 包含文字矩阵缩放，不能只使用 PDF 声明的字号（示例论文中常为 1）。基线转换到与版面相同的显示页坐标。
2. 页面分析在 `formula-analysis.ts` 中建立 `FormulaFragment`：独立公式来自 Heron，行内候选来自希腊字母、数学字体/短斜体变量与基线位移。保存来源文档、页码、区域、字形索引、行内/行间形式、基线和有效字号。简单单基线与上下标生成 `native-candidate`；分数等二维结构不根据字符顺序猜测。
3. `select-region.ts` 将公式位置写为 `[[formula:ID]]`，保留在原阅读顺序中，同时从页面字形缓存补入该公式的 `characters`。因此已有页面缓存无需重新跑 Heron/PDFium。部分选中时创建裁剪来源，撤销 LaTeX 候选、标记 `partial`，只保留实际选中的字符证据与 `nativeText`，禁止扩大为完整公式。正文中的普通半词选择仍不补全。
4. `formula-source.ts` 在首次翻译时按需生成 4×（约 288 dpi）、无损 PNG，独立于阅读器缩放；每区域上限 400 万像素。原始 PDF 与归一化裁剪是外观依据。`services.formulas.exportPdf(fragment)` 在 Worker 中导入原 PDF 页资源，转换坐标并设置 CropBox/MediaBox，保留字体、路径、图片与原旋转。此操作是可见区域裁剪，不是内容删改；不可作为安全删除页外内容的功能。
5. 用户框选并启动翻译后，`formula-translation.ts` 将未识别且完整选中的区域交给独立选择的 OCR 模型，再翻译正文。`ocr-settings.ts` 读取独立的 `formulaOcrModel` 设置；旧安装未配置时保留翻译模型的图像转写方式。GLM 版面接口逐张提交 PNG，专用 Chat OCR 逐张提交固定任务 `Formula Recognition:`，多模态 LLM 证据方案每批最多 12 个。不在页面分析时调用远端模型，也不额外安装本地公式 OCR 权重。`formula-transcription.ts` 负责截图与 PDFium 辅助证据的固定 prompt：字符 Unicode、字形索引、框、基线、有效字号与字体；坐标转换为裁剪区域内的 PDF 点，独立于屏幕缩放。明确告知模型 PDF 存储顺序不等于阅读顺序，字符身份来自 Unicode，二维结构结合坐标与截图恢复。明显分离的右侧数字编号单独标为 `equation-label`。
6. 多模态 LLM 的 JSON/唯一 ID 或专用 OCR 规范化结果通过后，校验 KaTeX 语法，还比较 MathML 可见叶节点和原生字母/数字的计数，拦截丢字、大小写或 0/o 等替换；排除独立编号和 generated 字符，不把 LaTeX 命令名当作内容。允许额外字符以兼容路径/图片导致的原生提取缺失。因此这只是必要条件，不能证明没有新增符号、结构正确或数学等价；结果仍为 `model-candidate`。文字模型可以复用新版候选，不发送图像载荷。识别失败、返回 null/无效 LaTeX、字符检查失败时保留原图并报告原因；服务商错误正文沿用平台的脱敏与 i18n。识别请求失败后停止后续识别批次，不自动重试；正文仍可以使用原图和公式标记翻译。
7. 翻译请求包含正文位置标记和 LaTeX 阅读候选。`formula-references.ts` 校验返回标记的数量、ID 和顺序，漏掉、重复、增加或重排则拒绝结果。`TranslationResult` 提供 markdown 与来源资产；重建原文和译文中的 `MathMarkdown.tsx` 都按原位置使用同一份已准备的 LaTeX，正文翻译模型不改写公式。未识别/部分选中的公式显示来源 PNG，并按原基线对齐行内公式。原始图像与矢量资源继续保留供核对，保真 PDF 裁剪导出仍使用原始资源。
8. `translateRegion` 经 `onPhase` 回传准备/翻译状态，`onPrepared` 回传这次翻译实际使用的候选与失败原因。翻译弹窗为三栏：PDF 图片、重建原文、译文。中栏与右栏显式使用 `MathMarkdown` 的 `latex-candidate` 显示方式，中栏可切换到 LaTeX 源文本；识别完成立即更新，不等待正文翻译结束，翻译失败后也能继续核对原文。取消旧的折叠“查看提取的文字”入口。

公式资产保存在独立浏览器 IndexedDB `cachalot-formulas/assets`，桌面复用 SQLite `page_analysis` 与外键级联。缓存含坐标，坐标变化会失效；多模态 LLM 候选按 `transcribe-v2-native:<providerId>:<modelId>` 保存，专用 OCR 按 `formula-ocr-v1:<protocol>:<providerId>:<modelId>` 保存。显式 OCR 选择只使用该模型的候选，停用、删除或协议不匹配时报错；旧文字模型的候选兼容路径仅在未配置独立 OCR 时使用。只复用新版且字符检查通过的结果。旧 image-only 候选不冒充新证据方案的结果，原图资产继续复用；读缓存时合并本次选区的字符元数据，避免旧资产覆盖新证据。页面缓存保持 `rules3-formulas2` 与原生字形 `native-rules2-metrics`，本次不失效页面分析。修改公式定位或语义规则时还需更新对应页面/资产/转写缓存版本。

边界：行内定位是保守规则，模型也可能漏检独立公式；公式区域的完整性仍需对照原页核对。原图/矢量来源能保证已定位区域的外观，不能证明 OCR LaTeX 的数学正确性。尚未安装 Docling CodeFormula 等额外本地权重，也未实现整篇译文 PDF 重排导出。接口和来源资产已为后续工作准备。

### 远端 OCR 服务与模型管理

`ModelInfo.formulaOcr` 是已添加模型的接口类型（`glm-layout` / `formula-chat` / `vision-llm`），与 `addedModels:<providerId>` 一起保存，不增加第二份模型目录或 SQL 表。`chatModels/ocrModels` 为两个菜单提供派生列表；专用 OCR 不进入翻译或问答默认模型。`OcrSettings.tsx` 复用分组 `ModelPicker`，独立选择立即持久化；未完成的新选择仍使用此前保存的方式。

`ProviderEditor.tsx` 为「模型服务」和「公式 OCR」复用表单，但根据 `providerPurpose:<providerId>` 仅展示各自的服务商和操作。OCR 页管理 GLM 预设、密钥、模型接口类型及识别连接测试；模型服务页管理翻译/问答服务。用途标记与已添加模型同在设置存储中，原有服务商 ID 与凭据存储不变。旧版仅包含专用 OCR 模型的服务商按模型类型归入公式 OCR；混合用途服务商仍保留翻译/问答角色，其已配置的 OCR 模型也可在公式 OCR 页维护。

GLM 公有版面 API 为 `POST /api/paas/v4/layout_parsing`，JSON 包含 `model` 和 `file`（公式 PNG data URI），Bearer 鉴权。`domain/ocr.ts` 的端点解析与 Rust `glm_endpoint` 由同一组夹具约束，界面展示实际请求地址。`platform.glmOcr` / `ai::glm_ocr` 复用既有凭据存储，桌面不会为 OCR 向 JavaScript 暴露 keyring 密钥。HTTP 错误和 HTTP 200 的业务错误均保留脱敏正文和 request ID。120 秒超时，不自动重试；遇到请求失败后停止当前选区剩余 OCR 请求。

`infrastructure/ocr/formula-ocr.ts` 按接口类型调用模型并返回单一 LaTeX 候选。GLM 先读取唯一的 `layout_details` 公式块，没有公式块时只接收明确包围的 Markdown 数学块；多公式/空白/普通说明文本不能拼接为公式。专用 OCR 无法消费任意 PDFium 证据 prompt，所以字符证据在服务层做返回后校验。多模态 LLM 仍接收裁剪及字符坐标。原生简单公式和部分选中的公式不调用远端 OCR。缓存仅写入通过语法与字符检查的结果。

GLM 预设可用于智谱官方地址 `https://open.bigmodel.cn/api/paas/v4` 或 Z.AI 地址 `https://api.z.ai/api/paas/v4`；固定模型列表只提供 `glm-ocr`，不调用 `/models`。检查连接发送一张应用生成的测试公式；浏览器预览要求服务商支持 CORS，桌面使用 Rust HTTP 客户端。兼容 Chat 传输的远端公式模型可复用另一个适配器，其他鉴权/私有协议需单独实现。

### 标题结构的翻译与重排

`select-region.ts` 同时生成 `SelectedTextBlock[]`，保存选中块的类型、标题层级及是否只选中部分内容。`selection.text` 继续作为纯文本上下文。`heading-translation.ts` 在原文预览中生成 Markdown 标题，在翻译请求中用 `[[heading:ID]]…[[/heading:ID]]` 包住标题。模型只翻译其内容，返回后校验 ID、成对边界、顺序及非空内容，再由程序按原层级转为 `#`–`######`。标题标记遗漏、重复、错序或新增会显示中英错误并阻止复制，标题内的公式位置仍经过公式校验。流式预览隐藏标题协议标记；导出的译文 Markdown 不含标题协议。

Heron 没有给出精确层级，当前采用保守规则：明确 `title` 为 h1；重叠的 title/heading 预测优先保留标题语义（示例论文存在空 title 与有文字的 heading 重合）。章节标题默认 h2，数字编号深度和罗马章节下的字母小节推为更深层级；未来解析器可通过 `ContentBlock.headingLevel` 直接提供层级。无法判断的标题保留为 h2，识别错误或不常见的编号体系仍可能需要人工核对。依据来自完整原始块，不依赖翻译后的文字或裁剪后的编号。多行标题合并为一个标题；只选中半个标题仍按标题格式显示实际选中的文字，不补回未选中内容。标题结构从已有页面缓存派生，无需重新分析论文。

## 新界面接入示例

```ts
import { services } from "../application/services";

const bytes = await services.library.loadPdf(document.id);
const session = services.analysis.createSession(document, bytes, onPage, onProgress);
void session.start(currentPage);
const parsed = await session.getPage(currentPage); // 完整分析，内部复用并发请求和缓存
// 页面关闭、切换文档或卸载视图时：
session.dispose();
```

组件负责展示与事件。PDF 显示可替换为其他阅读器；应继续使用归一化选区 DTO 和 `selectRegion`。模型服务配置、会话 CRUD、流式翻译/问答都通过 `services` 调用。提示词和检索规则由应用层管理。异步 UI 回调要处理视图卸载、文档切换和新的选区覆盖旧请求。

界面样式使用 Tailwind CSS 4：`src/styles/app.css` 提供主题变量，`src/components/ui/styles.ts` 提供共用控件样式，页面布局直接位于 TSX。PDF.js 文字层兼容 CSS 单独保留。修改样式、格式化和浏览器截图验证的约定见 [样式维护指南](styles.md)。

界面多语言使用 i18next/react-i18next，词典集中在 `src/i18n/locales/`。业务服务与 Worker 的提示通过 `src/domain/messages.ts` 编码，由显示层转换成当前语言；解析缓存不因界面语言变化而失效。语言偏好通过现有设置接口保存，维护约定见 [i18n 指南](i18n.md)。

## 验证与当前边界

```bash
npm run test:analysis
npm run test:formulas
npm run test:headings
npm run test:formula-transcription
npm run test:formula-transcription-ui -- /absolute/path/reference.pdf
npm run test:formula-sources -- /absolute/path/reference.pdf
npm run test:reader
npm run test:paper -- /absolute/path/reference.pdf
# 首次需要安装 Playwright Chromium；也可用 CACHALOT_CHROMIUM 指定已安装可执行文件。
npm run test:browser -- /absolute/path/reference.pdf
npm run build
cd src-tauri && cargo check
```

参考论文：`Design_Control_and_Performance_of_Tracking_Power_Supply_for_a_Linear_Power_Amplifier.pdf`（用户提供，7 页）。检查双栏、矢量电路/曲线、位图波形、公式、说明、第 7 页表格。脚本将结构和截图保存到忽略 Git 的 `test-results/`；论文不打包、不提交。

2026-09-26 验证：7 页直接解析（WASM CPU 单线程）约 37 秒，包括模型初始化；这个耗时只代表当前开发机。生产构建 Chromium 集成测试通过了框选正文左半边、缓存重开（不请求模型/PDFium 二进制）、仅缺失第 7 页时续解析、模型文件不可用后的重试。原生提取加完整分析的 JSON 序列化大小约 **7.7 MB**，这不是 IndexedDB/SQLite 实际磁盘占用；另外保存原始 PDF。模型约 171 MB，为应用共享资源，每篇论文不重复保存。

当前支持版面识别、原生字符提取、选区正文过滤、公式来源保留与按需转写、持久缓存和可视区域核对。PDF.js 继续负责显示。尚未接入扫描件全文 OCR、TableFormer，尚未实现整篇图文混排译文导出；公式矢量区域导出已有服务接口。图表原图保留在翻译预览中。模型区域预测与阅读顺序可能出错，“版面”开关用于核对。桌面 Chromium 的通过结果不能替代 iPad Safari/WebView 真机测试。
