# 前端重构验收

[前端交接](frontend-handoff.md) · 权威运行约定：[测试维护](../tests/README.md)

本页用于开发者自检与交接审阅。表中为已有功能及必须保留的行为，不要求继续使用原视觉或组件路径。状态与实现入口在前端交接页；新增行为在对应现有测试模块维护。

## 验证环境与材料

- 中文和英文各覆盖 1440×1000、1194×834 横屏布局，核对长标题、模型 ID、错误正文、三栏与插件面板，页面不出现意外水平溢出。
- 自带数据的浏览器用例使用合成 PDF 与模拟模型/OCR；真实论文回归需要另提供 PDF。不读用户文献库或真实密钥。
- 键盘至少检查设置浮窗的 Ctrl/Cmd+,、分类搜索、Esc、焦点限制/恢复、放大/还原，及通用弹窗、菜单、页码输入、语言/模型选择与可见的关闭操作。触摸和桌面 WebKit 另用目标设备验证。
- 截图用于审阅视觉；交互、数据、取消与保持状态使用行为断言。记录提交、环境、运行组、截图目录及未验证设备。

## 功能验收矩阵

| 范围               | 操作与需要观察的结果                                                                                                    | 现有自动化入口                                                                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文献库             | 导入/拖入、多 PDF 与同内容重复导入；空库和搜索无匹配分开；长标题、预览错误可处理                                        | [visual-layout](../tests/e2e/visual-layout.spec.ts)与[reader-analysis](../tests/e2e/reader-analysis.spec.ts)                                                          |
| 分类/收藏/排序     | 普通分类、收藏相互独立；移动、删除分类不删论文；四种顺序、搜索范围与偏好恢复                                            | [library-categories](../tests/e2e/library-categories.spec.ts)、[library-sort](../tests/e2e/library-sort.spec.ts)                                                      |
| 连续阅读与分析     | 自然滚动、缩略图/目录/页码跳转、无效页码、末页与混合页尺寸；缩放位置合理；进度、缺页恢复和模型缺失重试                  | [reader-navigation](../tests/e2e/reader-navigation.spec.ts)、[reader-analysis](../tests/e2e/reader-analysis.spec.ts)                                                  |
| 完整单元与文字选择 | 完整段落/行间公式命中，部分排除，行内公式随段落；反向拖动与缩放后来源一致；精确文字不补全；用户模式不被延迟激活抢走     | [reader-navigation](../tests/e2e/reader-navigation.spec.ts)、[extensions](../tests/e2e/extensions.spec.ts)                                                            |
| 翻译结果与公式     | 三栏、阶段、原文/LaTeX 切换、来源图片/基线、标题、流式与最终结果；OCR 失败回退；协议失败不开放复制；关闭/重试取消旧任务 | [formulas-transcription](../tests/e2e/formulas-transcription.spec.ts)、[visual-layout](../tests/e2e/visual-layout.spec.ts)                                            |
| 本体问答与附图     | 历史会话与消息操作、增量回答；上传图片、模型菜单向上展开；含图草稿切文字模型仍保存但禁止发送；既有图像不丢失            | [visual-layout](../tests/e2e/visual-layout.spec.ts)、[extensions](../tests/e2e/extensions.spec.ts)                                                                    |
| 模型/密钥/错误     | 未保存草稿、已添加/远端目录区别、逐模型图像能力；遮罩不变新密钥、显示后恢复隐藏、留空保留；长错误与 request ID 可读     | [models-added](../tests/e2e/models-added.spec.ts)、[models-credentials](../tests/e2e/models-credentials.spec.ts)、[models-errors](../tests/e2e/models-errors.spec.ts) |
| 独立 OCR           | 关闭/当前/独立三种模式；明确接口类型与连接测试；OCR 配置不改变聊天模型；失败不静默换服务                                | [formulas-transcription](../tests/e2e/formulas-transcription.spec.ts)                                                                                                 |
| 缓存               | 六类统计、单类确认与清除、刷新统计；论文/分类/会话/图片/密钥/插件保持；预览可重建                                       | [settings-cache](../tests/e2e/settings-cache.spec.ts)                                                                                                                 |
| 通用插件 UI        | 停用翻译后本体仍可用；动态工具/树/Webview/状态项、侧栏/底栏/设置/modal；关闭、重新打开、移动、尺寸、语言与释放          | [extensions](../tests/e2e/extensions.spec.ts)、[extension-installation](../tests/e2e/extension-installation.spec.ts)                                                  |
| 插件安装与依赖     | 多包、缺失/循环/不兼容、版本更新、公开 API、内置保护、级联操作与 Worker 失败恢复；外部包持久恢复                        | [extension-installation](../tests/e2e/extension-installation.spec.ts)                                                                                                 |
| 生命周期与设置     | 打开设置期间保持阅读和待完成本体请求；栏目/语言切换保持模型服务及插件设置草稿；插件安装、更新、重启不重建本体           | [extension-installation](../tests/e2e/extension-installation.spec.ts)、[visual-layout](../tests/e2e/visual-layout.spec.ts)                                            |

“现有自动化入口”表示应维护/扩展的验证模块，不代表它们已经自动断言这一行的每个视觉细节或所有组合。阅读、翻译与部分布局入口标记 @paper，未给真实 PDF 时会跳过；看到 test:e2e 通过不等于这些路径已经运行。

## 状态画面不能遗漏

| 界面     | 至少覆盖                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------- |
| 文献库   | 空库、正常、搜索无结果、导入中、导入失败、菜单与确认                                               |
| 阅读器   | 加载、原生文字可用但布局未完成、完整布局、分析失败/重试、无目录、无命中、无效页码                  |
| 本体问答 | 无模型、会话加载、草稿/附图、运行中、图像能力不符、错误、长回答/公式                               |
| 模型设置 | 无服务商、新建未保存、已存密钥遮罩/显示/替换、目录加载与失败、添加模型、保存错误                   |
| 翻译     | 无模型、准备中、正文流式、公式问题、失败/重试、最终校验与复制、关闭                                |
| 插件管理 | 空安装预览、解析中、有效包、缺包/循环、更新/降级、级联影响、inactive/active/disabled/blocked/error |
| 缓存     | 加载、空类别、有内容、确认、清除中、失败、重新统计                                                 |

未实现的扫描件全文 OCR、语义自动大纲、全文译文 PDF、插件市场、自动升级和签名不要以可用按钮进入验收。若另行增加这些功能，维护单独的真实行为与文档契约。

## 最容易被布局重构破坏的链路

1. 打开 PDF，缩放并滚动到中间页，输入聊天草稿或使用模拟服务挂起一次问答。
2. 打开设置：底下工作区不可点击/聚焦，阅读器、分析会话和聊天保持挂载。
3. 切换栏目与 UI 语言：模型服务草稿和插件设置草稿保持；所有新标签正确。
4. 安装或更新示例插件，重启插件，再停用/启用翻译插件：相关插件资源释放与恢复，本体 PDF 节点/页码/缩放和等待中的问答保持。
5. 返回阅读器：草稿/附图与滚动状态仍正确；问答按原请求完成，不因宿主重载重发。
6. 新旧框选/模型请求交错：旧 preview/select、识别或翻译结果不能覆盖新选择，也不能在关闭后重新弹出。

第 4 步保留 PDF 节点是现有生产插件回归的断言；重构者应保留这一连续性。不要用刷新页面、重启本体或在所有状态外加一个变化 key 来恢复插件。

## 按影响选择运行组

基本源码与构建检查：

```sh
npm run test:types
npm run format:check
npm run build
```

以实际改动选择上述矩阵中的浏览器模块；例如插件外壳与设置生命周期：

```sh
npm run test:e2e -- tests/e2e/extensions.spec.ts tests/e2e/extension-installation.spec.ts
```

动到阅读几何、文字层、选区、翻译公式显示或整体横屏布局时，运行相关真实论文用例；完整入口为：

```sh
npm run test:e2e:paper -- /absolute/path/reference.pdf
```

单项论文命令、自动缓存、Playwright 浏览器与 CACHALOT_URL/CACHALOT_CHROMIUM 配置集中在[测试维护指南](../tests/README.md)。修改纯规则/服务/SDK 时增加对应 unit/integration 验证；修改 Rust 时验证原生实现。维护已有边界，不新增按“UI 重构任务”命名的独立验证脚本。

## 交付记录

写明重构范围、组件/状态迁移、实际通过的命令、使用的 PDF/模拟夹具与设备、截图位置以及未验证项。截图包含两种语言与横屏尺寸的主界面、设置、翻译和动态插件。测试输出与私人 PDF 不提交；截图中的服务商配置只使用固定测试值。

功能说明或入口变化时，同时更新用户指南、样式/多语言约定、插件视图文档和本交接清单。旧视觉可以变化，领域身份、来源、保存/取消与插件边界的回归要能解释。
