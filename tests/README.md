# 测试维护指南

测试按验证边界组织，不按开发任务或提交时间增加 `verify-*.ts` 脚本。

| 位置 | 验证内容 | 运行器 |
| --- | --- | --- |
| `unit/` | 版面、公式、标题、排序、文案等纯逻辑 | `node:test` |
| `integration/` | 存储、接口适配与 PDFium 资源行为 | `node:test`；真实 PDF 个案单独运行 |
| `e2e/` | 文献库、阅读、设置、问答和翻译的用户操作 | Playwright |
| `e2e/scenarios/` | 多个界面用例复用的操作片段，不单独执行 | Playwright 用例调用 |
| `fixtures/` | 固定输入、预期响应和跨语言契约数据 | 各层共用 |
| `support/` | 论文缓存、浏览器存储准备等测试基础设施 | 各层共用 |

## 运行

```bash
npm run test:types       # 测试源码也参与 TypeScript 检查
npm run test:unit
npm run test:integration
npm run test:e2e         # 自备数据的浏览器用例；真实论文用例自动跳过
npm run test:all         # 类型检查和上述三个运行组
```

Playwright 默认在 `127.0.0.1:1420` 启动或复用开发预览。已有预览可通过 `CACHALOT_URL` 指定；已有 Chromium 可通过 `CACHALOT_CHROMIUM` 指定可执行文件。首次使用 Playwright 自带浏览器时运行 `npx playwright install chromium`。`test:all` 不下载模型，也不使用用户文献库或 API Key。Vite 忽略 `test-results/` 和 `.test-cache/` 的文件变化，避免导出 trace 中的 HTML 时触发整页刷新；新增输出目录时也要维护这一排除规则。

用户提供的七页电源论文是**可选的真实论文回归**，用于检验复杂双栏、公式和图表。论文文件不提交到仓库。运行全部论文用例：

```bash
npm run models:prepare
npm run test:e2e:paper -- /absolute/path/reference.pdf
```

也可用 `test:formula-transcription-ui`、`test:reader-navigation` 等已有命令运行单个论文用例，参数仍是 PDF 路径。`test:paper` 单独输出供人工检查的解析 JSON。论文浏览器用例无需先运行它：`support/reference-paper.ts` 根据 PDF 哈希与解析版本自动准备 `.test-cache/reference-paper/` 中的缓存，缓存失效时重新分析。`test-results/` 只放截图、Playwright trace 和检查结果，测试不从这里读取输入。真实论文首次分析需要本地 Heron 模型和较长的 CPU 时间。

## 新增和修改用例

1. 先选验证边界。规则、坐标、数据转换放 `unit/`；跨存储或 PDFium 放 `integration/`；真实点击、滚动、切换和错误显示放 `e2e/`。在相关能力的现有文件中增加**有名字、可独立定位失败原因**的用例；只有边界明显不同才新建文件。
2. 固定数据和服务响应放 `fixtures/`。浏览器用例使用独立 context 或 profile、模拟模型接口，并把重复的 PDF/分析缓存写入交给 `support/seed-paper.ts`；不要调用真实服务商或读取用户配置与密钥。
3. 一个用例只维护它所需的状态。可共享创建夹具的代码，不共享测试执行后留下的浏览器状态。一个后续用例不能依赖前一个用例生成的 `test-results` 文件、选择或缓存。涉及整条工作流的少数回归可用 Playwright `test.step` 标明阶段；新增的独立行为应另起用例。
4. 优先使用可访问角色与名称定位交互；布局细节使用稳定的 `data-ui`。多个文献卡片并存时按 `data-document-id` 定位目标，不依赖 `.first()` 或当前排序。截图用于人工审阅或失败诊断，不能代替行为断言。中英文、不同横屏宽度只覆盖对该行为有意义的组合。
5. 改动测试基础设施时运行 `test:types` 和受影响的测试组；改动真实论文流程时至少运行对应单项回归。更新本文件中的命令或夹具约定，避免在其他文档复制长段测试步骤。

原有的 `test:*` 单项命令暂时保留为兼容入口，主要维护入口是上面的四个测试组。`e2e/visual-layout.spec.ts` 和 `e2e/formulas-transcription.spec.ts` 包含既有的长链路回归；新增行为应优先写成独立用例，而不是继续延长这两个流程。Rust 测试仍在 `src-tauri/` 通过 Cargo 运行。桌面 Chromium 回归不等于 iPad 真机验证。

缓存管理用例集中在 `integration/cache-management.test.ts`（分类统计、独立清除、用户数据隔离及异步写入代次）、`integration/native-cache.test.ts`（Tauri 路由与公式记录契约）及 `e2e/settings-cache.spec.ts`（中英文清除确认、统计刷新及预览重建）。共用 `fixtures/cache.ts` 的小型 PDF 与旧版本缓存，`support/seed-caches.ts` 同时供 IndexedDB 适配器和隔离浏览器使用。SQLite 真正的分类查询/删除由 Rust `cache::tests` 覆盖；Tauri 调用模拟不能代替 SQL 验证。

OCR 用例按边界组织：`integration/ocr.test.ts` 维护内置厂商的协议/响应夹具，`integration/ocr-adapters.test.ts` 验证第三方适配器的元数据、模型目录、调用及缺失适配器行为。Node 测试通过 `support/register-ocr.ts` 自动发现生产代码的 `ocr/providers/*.ts`，不维护第二份注册名单。浏览器与 Rust 的通用传输共用 `fixtures/ocr-http.json`；TypeScript 在 `unit/ocr-http.test.ts` 验证，Rust 在 `ocr_http::tests` 验证。已有真实论文 `e2e/formulas-transcription.spec.ts` 覆盖 GLM 设置、独立选择、错误显示、字符校验、图片回退和缓存复用。添加厂商时先补它自己的接口夹具，再按影响范围选择回归，不调用用户的真实服务商。

`integration/native-ocr.test.ts` 仅验证 Tauri 命令路由、请求信封和 TypeScript 厂商响应解析；鉴权注入、地址校验及脱敏由 Rust 共享契约测试验证，不用命令模拟代替原生实现。

文档结构用例集中在 `unit/document-semantics.test.ts`（两层边界、全文标题证据、缺页、跨页来源投影、摘要及精确选区上下文）和 `integration/document-analysis.test.ts`（分阶段缓存、部分覆盖恢复、清除代次、关闭与重试、旧缓存迁移）。小型来源与检测输入共用 `fixtures/document-semantics.ts`；`support/analysis.ts` 通过生产构建器生成测试投影。真实论文缓存保存 `{ facts, observations, semantics }`，页面视图在读取时投影，不再保存混合页面分析。
