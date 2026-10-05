# Cachalot

理解学术文档版面的 PDF 阅读器，提供连续阅读、文献管理和论文问答。选区翻译作为首个内置插件预装，可停用、不可卸载；附加功能通过公开 SDK 扩展。

本体使用 PDF.js 显示原文、PDFium 提取字符和绘图对象、固定版本的 Docling Heron ONNX 识别版面。TypeScript 应用服务与 React 界面分层，桌面端使用 Tauri 2、Rust 和 SQLite。分析在本地进行；翻译、问答和远端公式 OCR 使用用户配置的模型服务。

## 从这里开始

| 我想做什么                     | 文档                                      |
| ------------------------------ | ----------------------------------------- |
| 运行软件，完成第一次阅读与翻译 | [快速开始](docs/get-started.md)           |
| 管理论文、阅读、翻译和问答     | [用户指南](docs/README.md#用户指南)       |
| 安装或管理本地插件             | [插件管理](docs/user-guide/extensions.md) |
| 开发一个插件                   | [插件开发入口](docs/extensions.md)        |
| 修改本体或新增 OCR 厂商        | [开发与贡献](docs/development.md)         |
| 查找某个问题或数据契约         | [文档总目录](docs/README.md)              |

## 从源码运行

准备 Node.js 24.x、Rust 和 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)，在仓库根执行：

```sh
npm ci
npm run models:prepare
npm run tauri dev
```

浏览器预览使用 `npm run dev`。Heron 权重约 171 MB，首次准备会下载并校验，运行时读取本地资源。浏览器预览和桌面应用使用不同的数据存储；服务商是否允许浏览器请求取决于其 CORS 配置。环境与构建步骤见 [快速开始](docs/get-started.md)。

## 当前能力

- 连续纵向阅读、缩略图、PDF 原有目录、页码恢复、分类、收藏、搜索和排序。
- 页面事实、原始版面观测与文档级语义分层表示，逐页分析并恢复缺失阶段。
- 完整单元框选与精确文字选择，有限论文背景、公式来源保留、按需 OCR、三栏翻译核对。
- 基于页面文字检索的本体问答、历史会话和用户附图，逐模型配置图像能力。
- 本地多包插件安装、依赖诊断、独立 Worker、工作台视图与插件重启。
- 六类可再生缓存独立管理，简体中文和英文界面。

尚未实现扫描件全文 OCR、整篇 PDF 译文重排导出、插件市场、在线自动升级和签名验证。公式 LaTeX 是候选，语法与字符检查不能证明数学正确。桌面端为主要运行环境；iPad 和桌面 WebKit 的实际打包兼容性仍需相应设备验证。

## 验证与贡献

```sh
npm run test:types
npm run test:unit
npm run test:integration
npm run test:e2e
```

真实论文回归、浏览器环境和夹具约定见 [测试维护指南](tests/README.md)。构建、本体分层、样式和文案维护见 [开发与贡献](docs/development.md)。模型许可证见 [模型许可说明](public/licenses/MODELS.md)。
