# 开发与贡献

[文档目录](README.md) · 相关：[架构](architecture.md)、[数据契约](document-analysis.md)、[测试维护](../tests/README.md)

本页面向修改阅读器本体的维护者。负责 UI 重构时先读[前端交接](frontend-handoff.md)与[验收清单](frontend-acceptance.md)，了解工作区挂载、服务入口和动态插件外壳。只添加阅读附加功能时，先评估[插件 SDK](extensions.md)是否足够；OCR 厂商协议目前是构建时适配器，本体开发与运行时插件开发是两条路线。

## 环境、启动与构建

按[快速开始](get-started.md)准备 Node、Rust、Tauri 系统依赖与模型。命令在仓库根运行，Cargo 命令可使用 manifest-path，无需改变终端目录。

```sh
npm ci
npm run models:prepare
npm run dev
```

桌面开发使用 `npm run tauri dev`。生产构建和验证可执行：

```sh
npm run build
npm run preview
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml --lib
npm run tauri build -- --debug --no-bundle
```

build 首先离线校验固定权重，不应在安装后的用户操作中下载模型。构建产物在 dist 与 src-tauri/target，依赖、权重、数据库和测试输出不提交。

## 并行开发工作树

多个对话或开发者应使用不同 Git worktree 与开发分支。工作树隔离文件、暂存区和 HEAD，仍共享仓库对象与分支引用；不要在同一 checkout 中相互切换分支。

每个工作树使用不同预览端口与 Vite 缓存：

```sh
CACHALOT_VITE_CACHE=/tmp/cachalot-feature-vite npm run dev -- --host 127.0.0.1 --port 1431 --strictPort
CACHALOT_URL=http://127.0.0.1:1431 npm run test:e2e
```

自行准备依赖；若本机通过链接共享 node_modules，尤其要隔离 Vite 缓存。模型与构建输出不从另一个工作树提交。最终集成到 main 与开发工作树的提交是不同操作。

插件脚手架和本地 SDK 导出命令见[插件教程](extension-api/get-started.md)；生成输出属于独立插件项目，不提交回本体作为临时构建产物。

## 目录与依赖方向

```text
src/domain/                       数据契约、几何、身份与纯规则
src/application/                  应用服务与处理流程
  document-analysis/              页面事实到文档结构
  ocr/                            明确公式区域的候选准备
  extensions/                     安装计划、依赖、作用域与能力适配
src/infrastructure/               PDFium/ONNX、存储、网络、平台与消息桥
src/components/                   React 界面与通用工作台
src/extensions/selection-translation/  首个内置 SDK 使用者
src/sdk/                          插件公开接口和可信 UI 工具
src-tauri/src/                    桌面 SQLite、文件、密钥与 HTTP
```

本体界面从 application/services.ts 调用服务；插件只使用 SDK。文档分析不依赖 OCR/插件，OCR 不依赖翻译协议，domain/infrastructure 不反向依赖 application。只有 extensions/runtime.ts 组合入口能导入内置插件。源码目录的更细分工见[应用层指南](../src/application/README.md)。

## 按改动选择入口

| 要改什么             | 首先阅读                                                    | 验证边界                                    |
| -------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| 段落、标题、跨页关系 | document-analysis 与 domain/document-semantics              | 语义单元、来源引用、部分覆盖、缓存恢复      |
| 字符提取、坐标、模型 | infrastructure/analysis 与 domain/model                     | Worker/PDFium、旋转、版本与真实论文         |
| 公式定位或候选校验   | document-analysis/formulas 与 application/ocr               | 精确范围、字符证据、取消与缓存版本          |
| OCR 厂商             | [适配器指南](../src/infrastructure/ocr/providers/README.md) | 请求/响应、业务错误、共享传输               |
| 模型目录、地址、密钥 | model-catalog、api-endpoint、platform                       | 两端地址夹具、脱敏、持久保存和逐模型能力    |
| 插件生命周期/桥      | application/extensions 与 infrastructure/extensions         | 依赖、取消、登记回滚、Worker 错误及生产构建 |
| 阅读布局与选择       | PdfReader、PdfPageView、page-layout                         | 连续阅读、缩放、工具代次、横屏、中英文      |
| 界面文案与样式       | [i18n](i18n.md)、[styles](styles.md)                        | 双语键、插值、草稿保持及行为布局回归        |
| 存储与缓存清理       | platform、cache-management、Rust db/cache                   | 用户数据隔离、事务、清除代次和原生 SQL      |

纯代码移动不要改缓存身份；规则或协议变化按[版本表](document-analysis.md#版本与缓存变更)更新。新公共 API 同时检查可信实现和社区消息桥，不能只让内置模块能调用。

## 调试

| 环境           | 观察点                                                     |
| -------------- | ---------------------------------------------------------- |
| Vite 开发预览  | 浏览器 Console/Network、分析 Worker、插件 Worker 与 iframe |
| 生产浏览器预览 | dist 中实际 bundle、Blob Worker 序列化、CSP、资源路径      |
| Tauri 桌面     | Rust 终端、Webview 错误、系统密钥库与实际桌面 HTTP         |
| 真实论文       | 指定页的 Box、字符索引、来源版本、观测与语义投影           |

开发期延迟发现依赖可能触发 Vite 全页重载，因此已有延迟/Worker 依赖在 optimizeDeps 中预处理。新增输出目录应加入 watcher 排除，不让 trace HTML 变化刷新应用。应用刷新与 Restart extensions 的生命周期不同，不用开发服务器重载证明插件安装需重启本体。

服务商协议使用固定夹具，不读真实账号或密钥。问题反馈中的错误正文需保持脱敏。临时独立 profile 适合试装故障插件，避免改动真实用户安装目录。

## 测试与提交

运行范围由风险决定，组织规则以[tests/README.md](../tests/README.md)为准：

```sh
npm run test:types
npm run test:unit
npm run test:integration
npm run test:e2e
npm run format:check
```

真实论文回归通过 `npm run test:e2e:paper -- /absolute/path/reference.pdf`，不用用户密钥。Rust 模拟路由不能替代原生 SQL/HTTP 契约测试；Chromium 不能代替桌面 WebKit 或 iPad。历史结果见[验证记录](validation.md)，不把过去的通过视为新改动已验证。

提交源码、资源、许可和锁文件，检查暂存内容；不提交 node_modules、dist、模型、测试输出、运行数据库或真实凭据。遵循项目[协作约定](../AGENTS.md)，远端配置与 push 不在日常自动提交授权内。

## 文档维护

UI 组件、状态归属、设置保持、插件外壳或阅读交互变更时，同时维护[前端交接](frontend-handoff.md)的源码入口与[验收矩阵](frontend-acceptance.md#功能验收矩阵)。

| 改动                     | 必须同步                                      |
| ------------------------ | --------------------------------------------- |
| 用户操作、模型或缓存行为 | 用户专题、排查表，必要时快速开始              |
| SDK 字段或能力           | 清单/API 参考、对应指南、可信与社区实现       |
| 插件运行限制或包格式     | 打包、生命周期、用户安装步骤                  |
| 来源/语义契约            | document-analysis、架构、相关缓存与测试说明   |
| 测试入口/夹具            | tests/README.md；其他页面链接它而不复制长规则 |
| 文案/样式组织            | i18n.md / styles.md                           |

教程使用能编译的完整示例，片段要明确前置清单/能力；不写未实现的 UI、市场、自动热载、迁移或权限。术语定义与来源以 SDK、domain/model 和实际适配器为准。新页面加入[总目录](README.md)与相关主题导航，移动页面时维护相对链接和已有章节锚点。

文档改动至少检查本地文件链接、章节锚点、命令是否存在、TypeScript 示例及涉及的包校验。仅改说明不需要重复运行无关的全套模型推理与浏览器回归。
