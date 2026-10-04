# 开发交接：解析、应用服务与界面

## 分层与入口

这是本地应用：业务服务以 TypeScript 接口提供，桌面存储与网络由 Rust/Tauri 承接。浏览器预览使用同一业务服务和同一分析 Worker，只替换存储及网络适配器。当前没有独立 HTTP 服务进程。

| 目录 / 文件 | 职责 | 界面重构时的处理 |
| --- | --- | --- |
| `src/domain/` | 文档、会话、版面 DTO；坐标和模型版本约定 | 复用数据契约，保持无 React / Tauri 依赖 |
| `src/application/services.ts` | 文献库、设置、模型服务、会话、解析、翻译、问答的统一入口 | 新界面调用这里 |
| `src/application/document-analysis/` | 文档分析生命周期、页内组装、全文语义及公式定位 | 建立/释放 session；规则变化时更新对应缓存版本 |
| `src/application/ocr/` | 独立 OCR 配置、公式裁图调度、识别、校验及候选缓存 | 通过公式区域 DTO 调用，不依赖翻译协议 |
| `src/application/selection-translation/` | 精确选区、背景范围、公式位置、标题格式、翻译请求及返回校验 | 使用目录公开入口或 `services.assistant.translateRegion` |
| `src/application/paper-assistant.ts` | 论文问答检索、会话上下文与模型请求组装 | 提供输入 DTO 和流式回调 |
| `src/application/model-catalog.ts` | 已添加模型配置、临时模型列表请求、逐模型图像能力 | 通过 services 获取，能力不按模型名称猜测 |
| `src/infrastructure/pdf/document-preview.ts` | 独立生成并缓存 PDF 第一页预览 | 通过 services.library.preview 调用 |
| `src/infrastructure/analysis/` | PDFium、ONNX、Worker RPC、缓存适配器 | UI 不直接访问 |
| `src/infrastructure/platform.ts` | 桌面命令与浏览器持久化/网络适配器 | UI 不直接访问 |
| `src-tauri/src/` | SQLite、PDF 文件、密钥库、模型 HTTP 请求 | 可独立演进；命令参数与 DTO 保持一致 |
| `src/hooks/useDocumentAnalysis.ts` | 服务与 React 生命周期的衔接 | 换框架时替换该桥接层 |
| `src/components/`、`src/App.tsx`、`src/styles/` | 页面、视图状态、PDF.js 显示、操作事件 | 可重新设计 |

### 应用层的三个环节

应用层按处理环节组织，而不是把所有公式文件归为同一个功能。目录与文件职责见 [application 维护指南](../src/application/README.md)。

- **文档分析**是底层：`session.ts` 管生命周期与分阶段缓存，`page-semantics.ts`/`document-semantics.ts` 管页内和全文结构，`formulas.ts` 管公式定位及原生简单结构。输出页面事实、文档语义和临时页面投影，不调用远端 OCR 或翻译，也不保存 OCR 候选到语义树。
- **OCR**是中间层：`reconstruct-formulas.ts` 接收上层明确指定的 `FormulaFragment[]`，通过 infrastructure 的裁图、适配器和仓库取得原图、识别并校验候选，返回 `{ assets, issues }`。它不接收整个 `SelectedRegion`，不产生公式位置标记、翻译提示词或译文。`validate-latex.ts` 管语法与字符检查；`settings.ts`/`catalog.ts` 管独立模型选择与派生设置选项。
- **框选翻译**是上层：`select-region.ts` 从文档分析投影确定实际覆盖，`context.ts` 从同一语义快照取有限背景；`translate-region.ts` 调用 OCR 公开入口，把候选与正文交给翻译模型；`formula-slots.ts` 管位置标记、候选说明和译文回填，`headings.ts` 管标题协议和格式恢复。

调用方向为框选翻译 → OCR → infrastructure，框选翻译也直接消费文档分析的领域数据。文档分析与 OCR 不反向导入框选翻译；domain/infrastructure 不导入 application。目录 `index.ts` 是受控公开入口，界面用 `services.ts` 调用有副作用的流程，纯选区及预览助手使用相应目录入口。内部单元测试可直接导入被测模块。

`createFormulaReconstructor(ports)` 允许替换裁图、设置、识别、候选保存等副作用；默认实现连接现有 infrastructure。这些端口用于隔离测试和替换运行环境，业务校验仍由 OCR 层统一执行。问答继续在 `paper-assistant.ts`；`services.assistant.askPaper/translateRegion` 的界面契约保持一致。此次目录/API 整理不改变事实、语义或 OCR 缓存版本，已有兼容缓存继续复用。

## 文献分类

`services.categories.list/create/remove` 管理自建分类，`services.library.move(id, categoryId)` 修改归属，`null` 表示未分类。`DocumentRecord.categoryId` 是可选的兼容字段；旧文献自动归入未分类。每篇论文只归属一个普通分类，“我的收藏”按既有 `starred` 标记汇集论文，收藏和移动互不影响。“全部文献”不按分类或收藏过滤。

桌面通过 `categories.rs` 创建 `categories` 表，幂等迁移添加 `documents.category_id` 外键，使用 `ON DELETE SET NULL` 在同一事务中解除归属。浏览器的 `browser-categories.ts` 在单个 `cachalot:categories` localStorage 记录中保存名称及归属映射，删除分类用一次写入完成；它不修改 PDF、对话或分析缓存。内置分类没有持久化记录或删除入口，适配器也拒绝删除不存在的分类。名称去除两端空白、限制 80 个字符，拒绝大小写重复名称及内置分类的中英文名称。

`CategorySidebar`、`LibraryDocumentCard` 和 `CategoryDialogs` 负责展示和事件；弹窗和三点菜单分别使用 `ui/Modal` 与 `ui/ActionMenu`。菜单通过 portal 避免卡片、滚动侧栏裁切，支持键盘和点击外部关闭。界面重构时保留服务契约即可。分类存储测试：`npm run test:categories`；原生迁移及删除保全测试：`cd src-tauri && cargo test --lib categories`；中英文完整交互：`npm run test:category-ui -- /absolute/path/reference.pdf`，论文分析会按需准备。

## 文献排序

`domain/library-sort.ts` 定义名称及导入时间的升序/降序比较，默认按首次导入时间由新到旧。导入时间使用 `createdAt`，与阅读活动的 `updatedAt` 分开；名称使用当前 UI locale 的 `Intl.Collator`，支持数字自然排序。同值用名称和文献 ID 确定顺序，排序不修改存储记录。搜索和分类先过滤，再使用相同排序偏好。

`LibrarySortMenu` 是受控菜单；App 通过 `services.settings` 保存 `librarySort` 后更新界面，浏览器与桌面沿用各自现有设置存储。非法或缺失偏好回退到默认。菜单复用 `ActionMenu` 的定位、关闭及键盘交互，选择项使用 `menuitemradio`。验证：`npm run test:library-sort`；启动预览后运行 `npm run test:library-sort-ui`，覆盖中英文、四种顺序、刷新恢复、分类和搜索。

## API 密钥显示与编辑

设置中的 `ApiKeyField.tsx` 将密钥显示和编辑草稿分开：`services.providers.keyPreview` 只返回前缀与末四位遮罩，点击眼睛才通过 `revealKey` 读取完整密钥；切换提供商、保存或退出设置都会恢复隐藏。只有实际输入才更新 `ProviderInput.apiKey`，留空保存保留现有密钥。桌面适配器从系统密钥库读取；浏览器适配器 `browser-provider-keys.ts` 使用 AES-GCM 加密后写入 IndexedDB，同时保存不可导出的 Web Crypto 密钥，不向 localStorage 写入原始凭据。浏览器存储属于当前 origin，同源脚本仍可使用加密密钥；它不具备系统密钥库的隔离能力。

浏览器密钥保存等待 IndexedDB 事务提交后才返回成功；存储失败会显示错误，不回退到内存。刷新、热更新整页重载及浏览器重启均可恢复；清除站点数据、隐私会话结束或更换域名/端口会使用不同存储。旧版仅存内存的密钥在重载后无法迁移，需重新输入一次。

服务商 HTTP / SSE 错误通过语言无关消息返回界面，保留 JSON、纯文本或 HTML 错误正文及请求 ID。浏览器与 Rust 使用共享错误样例验证；正文作为普通文本显示，隐藏凭据和图像数据，最多显示 16,384 个字符。

`domain/api-endpoint.ts` 同时供浏览器请求和设置的“实际请求地址”预览使用：只有域名时默认 `/v1`，已有 API 基础路径保持不变，完整 `/chat/completions` 或 `/models` 地址先还原为基础路径再拼接。保留查询参数，移除 fragment。Rust 的 `ai::endpoint` 使用同一规则；`tests/fixtures/api-endpoints.json` 是两端共享的契约测试数据，修改规则时需同步两端。

## 文档分析流程

1. 导入时计算 PDF 内容 SHA-256，作为文档 ID。PDF.js 读取目录、元数据和页数。
2. PDFium 原生提取生成 `PageFacts`：页面尺寸、字符、字形属性、对象和归一化坐标。`extract` Worker 请求只做提取，不生成段落或公式。
3. 原生提取顺序的文字作为临时问答索引。当前页优先，各页可独立完成，不等待全文版面分析。
4. `detect` Worker 请求把 PDFium 渲染的 640×640 RGB 图像交给固定版本 Heron ONNX，返回 `LayoutObservations`。它保存原始检测框、预测类别、置信度和模型版本，未做字符归属、去重或段落组装。
5. `document-analysis/page-semantics.ts` 将页面事实与版面观测组成语义片段；`document-analysis/document-semantics.ts` 汇总为唯一的 `DocumentSemantics`。缺失字符保留为回退块；标题层级、段落、阅读顺序、图注、子图和公式归属全部属于语义层。
6. 每个新页面生成替换式文档快照。页面结构由 `projectSemanticPage` 投影，选区与翻译输入绑定快照版本；缺少版面分析的页面打断章节和跨页连续性。
7. 页面事实、模型观测、文档语义分别持久化。关闭文档终止 Worker；重新打开时校验语义输入及字符/对象引用，复用兼容缓存，补齐缺失阶段。

使用的是 **Heron 版面模型 + Cachalot 的 TypeScript 语义构建器**，不是完整 Python Docling 管线。没有第二份权威页面结构；构建过程中的页面片段和界面的 `SemanticPageView` 都是内部阶段数据或临时投影。

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

`src/domain/analysis.ts` 定义页面事实、版面观测及选区/公式展示 DTO；`src/domain/document-semantics.ts` 定义文档语义及来源引用。

| 数据 | 包含内容 | 不应混入的内容 |
| --- | --- | --- |
| `PageFacts` | PDF 来源、提取版本、页面、原始字符/对象及坐标 | 段落、标题层级、阅读顺序、公式候选 |
| `LayoutObservations` | 原始 Heron 检测框、类别、置信度、模型版本 | 接受后的文档结构与字符归属 |
| `DocumentSemantics` | 节点、文字/公式内容片段、来源引用、阅读顺序、章节、关系、覆盖状态与推断依据 | OCR/LaTeX 候选和译文 |
| `SemanticPageView` | 页面事实引用及文档结构的页面投影 | 独立持久化的页面树 |

`SourceRef` 保存文档 ID、页面、事实版本、坐标、字符索引与对象 ID；一个语义节点可以引用多页的多个片段。节点 ID 只在相应来源/语义版本内有效。来源引用不反向改写页面事实。LaTeX 原生候选在投影时重建，远端候选仍由公式资产仓库独立管理。

文档快照记录事实覆盖、版面覆盖与缺页，章节关系允许暂定状态。跨页未结束段落只提出带依据的 `continues` 候选，不自动合并；有缺页时不建立连续关系。标题编号判断使用全文已知标题证据，重叠 title/heading 判断仍限制在同页。显式摘要标签用于标记摘要来源；不能确定时不生成摘要。

选区的 `source` 保存精确字符索引和使用的语义版本；`context` 从同一快照生成论文标题、摘要、章节路径、所在段落和相邻段落，并限制长度。背景材料仅供模型理解，输出范围仍以选区正文及标题/公式标记为准，不使用强制术语表。

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

桌面页面事实和模型观测保存在 SQLite `page_analysis(document_id, cache_key, page, content)`；文档语义保存在独立的 `document_semantics(document_id, cache_key, content)`。浏览器对应 `cachalot-analysis/pages` 和 `cachalot-semantics/documents`。写入成功以 SQLite 提交或 IndexedDB transaction complete 为准。

- 来源事实和模型观测均命中时，不加载 PDFium 或 ONNX。仅语义规则变化时直接重新组装。
- 部分完成的文档快照可以恢复；缺失的事实由 PDFium 提取，缺失的观测只运行对应页面的 Heron。引用源缺失或字形索引无法解析时重建语义，不使用悬空结构。
- 三类版本由 `domain/model.ts` 分别定义。模型变化不使字符提取失效，语义规则变化不使原始观测失效。
- 旧混合缓存仅按明确兼容的提取版本复用字符与对象，不迁移其段落、标题、公式或阅读顺序为新观测；首次升级会重新生成版面观测。
- 删除文档通过外键级联或浏览器文档索引清理来源与语义缓存。「设置 → 缓存管理」仍分别清除各类别的所有版本。

### 缓存管理

UI 只调用 `services.cache.usage/clear`，应用入口为 `application/cache-management.ts`；浏览器适配器为 `infrastructure/cache-management.ts`，桌面适配器为 Rust `cache.rs`。类别契约在 `domain/cache.ts`，浏览器缓存 schema 集中在 `infrastructure/cache-stores.ts`。

| 类别 | 浏览器 | 桌面 | 清除后的恢复 |
| --- | --- | --- | --- |
| PDF 原生提取 | `cachalot-analysis/pages` 中原生版本 | `page_analysis` 的原生版本 | 重新打开时由 PDFium 提取，并重新建立依赖它的文档结构 |
| 版面分析 | 同一 store 中的 Heron 原始观测 | `page_analysis` 的观测版本 | 重新运行 Heron，可复用原生数据 |
| 文档语义 | `cachalot-semantics/documents` | `document_semantics` | 重新组装，可复用事实与原始观测 |
| 问答文字索引 | localStorage `cachalot:page:` | `page_text` | 重新打开时从已有解析或新提取结果建立 |
| 论文首页预览 | `cachalot-previews/previews`，兼容旧 `setting:preview:` | `settings` 中 `preview:` 项 | 返回文献库后由 PDF.js 渲染 |
| 公式裁图与 OCR | `cachalot-formulas/assets` | `page_analysis` 中 `formula-assets:` 项 | 框选时重新裁图；复杂公式按设置请求远端识别 |

公式原图与 OCR 候选是同一条记录，作为一组清除，界面单独展示候选数量，并提示重新识别的服务商费用。桌面公式记录写入时带有 `schemaVersion/documentId/page/cacheKey` 包装，符合共享 SQLite 保存接口的身份校验。

统计的是已保存内容的 UTF-8 字节数，不包含主键、SQLite 页、索引、IndexedDB 结构化存储等额外开销；图像按实际保存的 Base64 字符串计数，而不是解码后的图片大小。旧混合缓存中的重复字符数据仍计入各自记录；新格式的观测与语义通过来源引用复用原生数据。清除释放逻辑内容，数据库可复用空闲空间，不承诺数据库文件立即缩小。所有旧解析/模型版本也在统计和清除范围内。

原始 PDF、文献元数据/分类/收藏/进度、聊天记录/上传图片、已添加模型、偏好和密钥属于用户数据，不是缓存。Heron、PDFium、PDF.js 是共享应用资源；浏览器的 HTTP 下载缓存由浏览器管理，不能可靠分类型统计/清除。阅读器的页面 Promise、canvas 和 Worker 属于临时内存，关闭文档时释放。

`cache-writes.ts` 按类别串行提交写入与清除。分析、预览和 OCR 在工作开始时捕获清除代次；清除先使旧代次失效，等待已开始的写事务，然后删除记录。旧后台任务稍后完成不会重新写回已清除类别，新工作仍可生成缓存。此协调作用于当前应用实例；另一个独立浏览器标签页使用论文时可能正常重建共享站点缓存。

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
2. `document-analysis/formulas.ts` 在文档语义中建立 `SemanticFormula` 区域：独立公式来自 Heron，行内候选来自希腊字母、数学字体/短斜体变量与基线位移。来源引用保存文档、页码、区域及字形索引，语义保存行内/行间形式、基线和有效字号。页面投影时生成 `FormulaFragment` 并为简单单基线与上下标恢复 `native-candidate`；分数等二维结构不根据字符顺序猜测。LaTeX 不进入权威语义缓存。
3. `selection-translation/select-region.ts` 将公式位置写为 `[[formula:ID]]`，保留在原阅读顺序中，同时从页面字形缓存补入该公式的 `characters`。因此兼容的来源与观测缓存无需重新跑 Heron/PDFium。部分选中时创建裁剪来源，撤销 LaTeX 候选、标记 `partial`，只保留实际选中的字符证据与 `nativeText`，禁止扩大为完整公式。正文中的普通半词选择仍不补全。
4. OCR 调度基础设施中的 [`src/infrastructure/pdf/formula-source.ts`](../src/infrastructure/pdf/formula-source.ts)，使用 PDF.js 在首次翻译时按需生成 4×（约 288 dpi）、无损 PNG，独立于阅读器缩放；每区域上限 400 万像素。原始 PDF 与归一化裁剪是外观依据。`services.formulas.exportPdf(fragment)` 在 Worker 中导入原 PDF 页资源，转换坐标并设置 CropBox/MediaBox，保留字体、路径、图片与原旋转。此操作是可见区域裁剪，不是内容删改；不可作为安全删除页外内容的功能。
5. 用户框选并启动翻译后，`ocr/reconstruct-formulas.ts` 将未识别且完整选中的区域交给独立选择的 OCR 模型，返回校验候选后，由 `selection-translation/translate-region.ts` 翻译正文。`ocr/settings.ts` 读取独立的 `formulaOcrModel` 设置；旧安装未配置时保留翻译模型的图像转写方式。GLM 版面接口逐张提交 PNG，专用 Chat OCR 逐张提交固定任务 `Formula Recognition:`，多模态 LLM 证据方案每批最多 12 个。不在页面分析时调用远端模型，也不额外安装本地公式 OCR 权重。`domain/formula-evidence.ts` 负责截图与 PDFium 辅助证据的固定 prompt：字符 Unicode、字形索引、框、基线、有效字号与字体；坐标转换为裁剪区域内的 PDF 点，独立于屏幕缩放。明确告知模型 PDF 存储顺序不等于阅读顺序，字符身份来自 Unicode，二维结构结合坐标与截图恢复。明显分离的右侧数字编号单独标为 `equation-label`。
6. 多模态 LLM 的 JSON/唯一 ID 或专用 OCR 规范化结果通过后，`ocr/validate-latex.ts` 校验 KaTeX 语法，还比较 MathML 可见叶节点和原生字母/数字的计数，拦截丢字、大小写或 0/o 等替换；排除独立编号和 generated 字符，不把 LaTeX 命令名当作内容。允许额外字符以兼容路径/图片导致的原生提取缺失。因此这只是必要条件，不能证明没有新增符号、结构正确或数学等价；结果仍为 `model-candidate`。文字模型可以复用新版候选，不发送图像载荷。识别失败、返回 null/无效 LaTeX、字符检查失败时保留原图并报告原因；服务商错误正文沿用平台的脱敏与 i18n。识别请求失败后停止后续识别批次，不自动重试；正文仍可以使用原图和公式标记翻译。
7. `selection-translation/formula-slots.ts` 从 OCR 返回资产生成翻译用候选说明；翻译请求包含正文位置标记和 LaTeX 阅读候选。`selection-translation/formula-slots.ts` 校验返回标记的数量、ID 和顺序，漏掉、重复、增加或重排则拒绝结果。`TranslationResult` 提供 markdown 与来源资产；重建原文和译文中的 `MathMarkdown.tsx` 都按原位置使用同一份已准备的 LaTeX，正文翻译模型不改写公式。未识别/部分选中的公式显示来源 PNG，并按原基线对齐行内公式。原始图像与矢量资源继续保留供核对，保真 PDF 裁剪导出仍使用原始资源。
8. `translateRegion` 经 `onPhase` 回传准备/翻译状态，`onPrepared` 回传这次翻译实际使用的候选与失败原因。翻译弹窗为三栏：PDF 图片、重建原文、译文。中栏与右栏显式使用 `MathMarkdown` 的 `latex-candidate` 显示方式，中栏可切换到 LaTeX 源文本；识别完成立即更新，不等待正文翻译结束，翻译失败后也能继续核对原文。取消旧的折叠“查看提取的文字”入口。

公式资产保存在独立浏览器 IndexedDB `cachalot-formulas/assets`，桌面复用 SQLite `page_analysis` 与外键级联。缓存含坐标，坐标变化会失效；多模态 LLM 候选按 `transcribe-v2-native:<providerId>:<modelId>` 保存，专用 OCR 按 `formula-ocr-v1:<protocol>:<providerId>:<modelId>` 保存。显式 OCR 选择只使用该模型的候选，停用、删除或协议不匹配时报错；旧文字模型的候选兼容路径仅在未配置独立 OCR 时使用。只复用新版且字符检查通过的结果。旧 image-only 候选不冒充新证据方案的结果，原图资产继续复用；读缓存时合并本次选区的字符元数据，避免旧资产覆盖新证据。原生提取、版面观测与文档语义分别使用 `PAGE_FACTS_KEY`、`LAYOUT_OBSERVATIONS_KEY`、`DOCUMENT_SEMANTICS_KEY`。公式资产还校验来源提取版本；修改语义规则可复用提取及模型观测，修改转写规则只影响候选。

边界：行内定位是保守规则，模型也可能漏检独立公式；公式区域的完整性仍需对照原页核对。原图/矢量来源能保证已定位区域的外观，不能证明 OCR LaTeX 的数学正确性。尚未安装 Docling CodeFormula 等额外本地权重，也未实现整篇译文 PDF 重排导出。接口和来源资产已为后续工作准备。

### 远端 OCR 服务与模型管理

`ModelInfo.formulaOcr` 是已添加模型的适配器 ID（内置 `glm-layout` / `formula-chat` / `vision-llm`），与 `addedModels:<providerId>` 一起保存，不增加第二份模型目录或 SQL 表。ID 采用可扩展字符串，不使用封闭的厂商联合类型；移除适配器时保留配置并提示不可用，不静默回退。`chatModels/ocrModels` 为两个菜单提供派生列表；专用 OCR 不进入翻译或问答默认模型。`OcrSettings.tsx` 复用分组 `ModelPicker`，独立选择立即持久化；未完成的新选择仍使用此前保存的方式。

`ProviderEditor.tsx` 为「模型服务」和「公式 OCR」复用表单，但根据 `providerPurpose:<providerId>` 仅展示各自的服务商和操作。OCR 页管理 GLM 预设、密钥、模型接口类型及识别连接测试；模型服务页管理翻译/问答服务。用途标记与已添加模型同在设置存储中，原有服务商 ID 与凭据存储不变。旧版仅包含专用 OCR 模型的服务商按模型类型归入公式 OCR；混合用途服务商仍保留翻译/问答角色，其已配置的 OCR 模型也可在公式 OCR 页维护。

`domain/ocr-adapter.ts` 定义识别输入/候选、模型预设、双语元数据和传输契约。`infrastructure/ocr/providers/*.ts` 每个文件默认导出一个实现，应用启动时由 `register-providers.ts` 自动发现并注册。`application/ocr/catalog.ts` 为设置页提供派生选项；`ocr/reconstruct-formulas.ts` 按适配器批次调用统一识别入口，负责候选校验、图片回退和缓存。厂商地址规则、任务 prompt、模型目录及业务响应解析只存在于对应文件。扩展流程见 [OCR 适配器开发指南](../src/infrastructure/ocr/providers/README.md)。

`ocr/transport.ts` 将提供商绑定到通用 JSON、Chat 和模型目录传输。JSON 请求由浏览器 `ocr/http.ts` 或桌面 `ocr_http.rs` 执行，适配器声明凭据位置（header/query/JSON/none），共享层注入密钥；带密钥请求限于已配置 origin，不跟随重定向。桌面不会为 OCR 向 JavaScript 暴露 keyring 密钥。HTTP 错误及适配器抛出的业务错误保留脱敏正文/request ID；成功 JSON 中回显的密钥也会脱敏。120 秒超时，不自动重试；遇到请求失败后停止当前选区剩余 OCR 请求。两端鉴权与请求验证使用同一组 `tests/fixtures/ocr-http.json`，Rust 不包含厂商端点或响应分支。

`infrastructure/ocr/formula-ocr.ts` 校验图像和批次大小后调用适配器，返回与输入 ID 对应的 LaTeX 候选。GLM 公有版面 API 的 `POST /api/paas/v4/layout_parsing`、`model/file` 字段、Bearer 鉴权和响应规则封装在 `providers/glm.ts`：先读取唯一的 `layout_details` 公式块，没有公式块时只接收明确包围的 Markdown 数学块；多公式/空白/普通说明文本不能拼接为公式。专用 OCR 无法消费任意 PDFium 证据 prompt，所以字符证据在服务层做返回后校验。`domain/formula-evidence.ts` 提供图像 LLM 的裁剪及字符坐标证据，`application/ocr/validate-latex.ts` 负责语法与字符保留检查。原生简单公式和部分选中的公式不调用远端 OCR。缓存仅写入通过语法与字符检查的结果。

GLM 预设可用于智谱官方地址 `https://open.bigmodel.cn/api/paas/v4` 或 Z.AI 地址 `https://api.z.ai/api/paas/v4`；固定模型列表只提供 `glm-ocr`，不调用 `/models`。检查连接发送一张应用生成的测试公式；浏览器预览要求服务商支持 CORS，桌面使用 Rust HTTP 客户端。常规 JSON / Chat API 新增一个适配器文件即可；multipart、二进制返回和签名鉴权需先扩展共享传输契约。新增文件在重新构建时加载，不是运行时插件系统。

### 标题结构的翻译与重排

`selection-translation/select-region.ts` 同时生成 `SelectedTextBlock[]`，保存选中块的类型、标题层级及是否只选中部分内容。`selection.text` 继续作为纯文本上下文。`selection-translation/headings.ts` 在原文预览中生成 Markdown 标题，在翻译请求中用 `[[heading:ID]]…[[/heading:ID]]` 包住标题。模型只翻译其内容，返回后校验 ID、成对边界、顺序及非空内容，再由程序按原层级转为 `#`–`######`。标题标记遗漏、重复、错序或新增会显示中英错误并阻止复制，标题内的公式位置仍经过公式校验。流式预览隐藏标题协议标记；导出的译文 Markdown 不含标题协议。

Heron 没有给出精确层级，当前采用保守规则：明确 `title` 为 h1；重叠的 title/heading 预测优先保留标题语义（示例论文存在空 title 与有文字的 heading 重合）。章节标题默认 h2，数字编号深度和罗马章节下的字母小节推为更深层级；未来解析器可通过 `ContentBlock.headingLevel` 直接提供层级。无法判断的标题保留为 h2，识别错误或不常见的编号体系仍可能需要人工核对。依据来自完整原始块，不依赖翻译后的文字或裁剪后的编号。多行标题合并为一个标题；只选中半个标题仍按标题格式显示实际选中的文字，不补回未选中内容。标题层级由文档语义构建器统一推断，选区翻译只读取结果；修改层级规则可复用原始版面观测。

## 新界面接入示例

```ts
import { services } from "../application/services";

const bytes = await services.library.loadPdf(document.id);
const session = services.analysis.createSession(document, bytes, onSnapshot, onProgress);
void session.start(currentPage);
const facts = await session.getPageFacts(currentPage);
const view = await session.getSemanticPage(currentPage); // 版面就绪的页面投影
const semantics = await session.getDocumentSemantics(); // 当前部分/完整文档快照
// 页面关闭、切换文档或卸载视图时：
session.dispose();
```

组件负责展示与事件。PDF 显示可替换为其他阅读器；应继续使用归一化选区 DTO 和 `selectRegion`。模型服务配置、会话 CRUD、流式翻译/问答都通过 `services` 调用。提示词和检索规则由应用层管理。异步 UI 回调要处理视图卸载、文档切换和新的选区覆盖旧请求。

界面样式使用 Tailwind CSS 4：`src/styles/app.css` 提供主题变量，`src/components/ui/styles.ts` 提供共用控件样式，页面布局直接位于 TSX。PDF.js 文字层兼容 CSS 单独保留。修改样式、格式化和浏览器截图验证的约定见 [样式维护指南](styles.md)。

界面多语言使用 i18next/react-i18next，词典集中在 `src/i18n/locales/`。业务服务与 Worker 的提示通过 `src/domain/messages.ts` 编码，由显示层转换成当前语言；解析缓存不因界面语言变化而失效。语言偏好通过现有设置接口保存，维护约定见 [i18n 指南](i18n.md)。

## 验证与当前边界

```bash
npm run test:types
npm run test:all
npm run test:e2e:paper -- /absolute/path/reference.pdf
npm run build
cd src-tauri && cargo check
```

测试的分层、单项命令、夹具与浏览器环境说明集中在 [测试维护指南](../tests/README.md)。

参考论文：`Design_Control_and_Performance_of_Tracking_Power_Supply_for_a_Linear_Power_Amplifier.pdf`（用户提供，7 页）。检查双栏、矢量电路/曲线、位图波形、公式、说明、第 7 页表格。脚本将结构和截图保存到忽略 Git 的 `test-results/`；论文不打包、不提交。

历史基线（2026-09-26，旧混合缓存）：7 页直接解析（WASM CPU 单线程）约 37 秒，包括模型初始化；这个耗时只代表当前开发机。生产构建 Chromium 集成测试通过了框选正文左半边、缓存重开（不请求模型/PDFium 二进制）、仅缺失第 7 页时续解析、模型文件不可用后的重试。原生提取加完整分析的 JSON 序列化大小约 **7.7 MB**，这不是 IndexedDB/SQLite 实际磁盘占用；另外保存原始 PDF。模型约 171 MB，为应用共享资源，每篇论文不重复保存。

2026-10-04 双层架构验证：类型检查、单元/集成测试、9 项 Rust 测试、生产构建和格式检查通过。隔离 Chromium 的全部 12 个界面用例通过，另行验证模型文件不可用后的重试；七页论文缓存重开不加载 PDFium/Heron，仅删除第 7 页观测后只补该页。公式原始矢量导出通过 CropBox 偏移与 0/90/180/270 度旋转验证。新增用例还覆盖全文标题证据、缺页、跨页节点来源投影、上下文与精确选区分离、缓存清除代次、Worker 并发恢复和缓存打开失败后的重试。

当前支持版面识别、原生字符提取、选区正文过滤、公式来源保留与按需转写、持久缓存和可视区域核对。PDF.js 继续负责显示。尚未接入扫描件全文 OCR、TableFormer，尚未实现整篇图文混排译文导出；公式矢量区域导出已有服务接口。图表原图保留在翻译预览中。模型区域预测与阅读顺序可能出错，“版面”开关用于核对。桌面 Chromium 的通过结果不能替代 iPad Safari/WebView 真机测试。
