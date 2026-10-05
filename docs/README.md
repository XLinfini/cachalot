# Cachalot 文档

这份文档对应仓库当前的 Cachalot 0.1.0 与插件 API 0.1.0。先按要完成的任务选择入口，再查阅参考。教程说明如何做，参考说明字段和边界，架构说明为什么这样组织。

## 用户指南

| 主题                                             | 你会了解                                           |
| ------------------------------------------------ | -------------------------------------------------- |
| [快速开始](get-started.md)                       | 源码运行、桌面与浏览器预览、第一次阅读和翻译       |
| [文献库与阅读](user-guide/library-and-reader.md) | 导入、分类、收藏、排序、连续阅读、目录和版面核对   |
| [选区翻译](user-guide/translation.md)            | 完整单元与文字模式、背景上下文、公式核对与结果复制 |
| [论文问答](user-guide/chat.md)                   | 检索范围、模型切换、图片、历史会话和回答边界       |
| [模型与公式 OCR](user-guide/models-and-ocr.md)   | API 地址、模型列表、图像能力、密钥和独立 OCR       |
| [插件管理](user-guide/extensions.md)             | 本地安装、补齐依赖、更新、停用、卸载和重启         |
| [数据与缓存](user-guide/data-and-cache.md)       | 存储位置、六类缓存、清除范围和数据恢复边界         |
| [常见问题与排查](user-guide/troubleshooting.md)  | 按现象定位阅读、模型、公式、插件及构建问题         |

## 插件开发

[插件开发入口](extensions.md)解释能力范围及与 VS Code 的异同。建议从[第一个插件](extension-api/get-started.md)开始。

| 文档                                                    | 用途                                        |
| ------------------------------------------------------- | ------------------------------------------- |
| [第一个插件](extension-api/get-started.md)              | 编写、打包、安装和更新一个可见的阅读工具    |
| [清单参考](extension-api/manifest.md)                   | `package.json` 字段、贡献点、能力和激活事件 |
| [生命周期与依赖](extension-api/lifecycle.md)            | 公开 API、激活次序、取消、状态、级联处理    |
| [视图与工作台](extension-api/views.md)                  | 命令、树、Webview、侧栏、底栏、设置与状态项 |
| [文档与阅读交互](extension-api/documents-and-reader.md) | 事实、语义、完整覆盖框、手势、选区和悬停    |
| [模型与公式](extension-api/ai-and-formulas.md)          | 流式 LLM、独立 OCR、来源资源和请求取消      |
| [API 参考](extension-api/api-reference.md)              | 当前公开接口的参数、返回值与能力要求        |
| [打包、测试与分发](extension-api/packaging.md)          | 包格式、资源、限制、验证和本地分发          |
| [交互设计约定](extension-api/ux-guidelines.md)          | 选择合适的 UI、双语、阅读状态及失败反馈     |

## 本体开发与维护

- [前端重构交接](frontend-handoff.md)：组件与服务地图、状态生命周期、可调整部分和必须保留的交互；配套[验收清单](frontend-acceptance.md)。
- [开发与贡献](development.md)：环境、构建、目录边界、变更入口和文档维护。
- [架构与数据流程](architecture.md)：服务分层、平台适配、分析、模型、缓存和插件宿主。
- [文档分析与数据契约](document-analysis.md)：两层表示、来源、坐标、覆盖状态、推断关系和版本。
- [应用层目录](../src/application/README.md)：分析、OCR、插件与问答的职责分工。
- [OCR 适配器开发](../src/infrastructure/ocr/providers/README.md)：构建时新增厂商协议与共享传输。
- [样式维护](styles.md)、[多语言维护](i18n.md)、[测试维护](../tests/README.md)：各自的权威维护约定。
- [验证记录](validation.md)：已执行的回归与仍需设备验证的范围。

## 如何理解支持范围

文中“已支持”指当前代码实现；示例插件提供的能力不意味着软件已经预装该功能。书签、悬停摘要等示例属于开发任务，只有选区翻译是当前预装插件。提到市场、签名、全文 OCR 或全文译文 PDF 时，均以明确的未实现说明为准。

公开 TypeScript 类型以 [SDK](../src/sdk/index.ts) 为准；运行约束还应结合清单校验器与宿主。内部领域类型不是额外的插件权限入口。文档按中文维护，产品文案与可见示例使用中文和英文。

目录组织参考 [VS Code 用户文档](https://code.visualstudio.com/docs)与[插件开发文档](https://code.visualstudio.com/api)的入门、专题指南、参考和维护主题，内容按 Cachalot 实际实现编写。
