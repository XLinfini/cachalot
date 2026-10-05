# 插件开发

[文档目录](README.md) · 入门：[第一个插件](extension-api/get-started.md) · 查阅：[API 参考](extension-api/api-reference.md)

Cachalot 的插件围绕学术 PDF 阅读器扩展。文献库、PDF 显示、页面事实、版面观测、文档语义、来源资源、OCR、模型配置和本体问答由宿主提供；选区翻译是第一个内置插件。

当前插件 API 为 0.1.0，公开入口是 [src/sdk/index.ts](../src/sdk/index.ts)。社区代码只使用公开 SDK、自己的包与打包依赖，不导入应用服务、平台适配器或其他插件源码。

## 你可以实现什么

| 任务                                       | 建议入口                                                |
| ------------------------------------------ | ------------------------------------------------------- |
| 阅读背景、覆盖框、悬停摘要、自定义选区工具 | [文档与阅读交互](extension-api/documents-and-reader.md) |
| 书签、大纲或分组列表                       | [树视图与命令](extension-api/views.md)                  |
| 侧栏、底部面板、设置或结果窗口             | [工作台与 Webview](extension-api/views.md)              |
| 利用论文事实和上下文调用 LLM               | [模型与公式](extension-api/ai-and-formulas.md)          |
| 依赖其他插件公开的服务                     | [生命周期与依赖](extension-api/lifecycle.md)            |
| 制作可本地安装的包                         | [打包、测试与分发](extension-api/packaging.md)          |

这些是 SDK 能力示例，不意味着对应插件都已预装。当前还没有任意文件系统、Node、任意网络请求、后台服务进程、运行时 OCR 厂商注册、市场发布或签名接口。

## 熟悉 VS Code 的开发者从哪里迁移

组织参考 [VS Code 插件文档](https://code.visualstudio.com/api)与[清单参考](https://code.visualstudio.com/api/references/extension-manifest)，保留常见名称和组织方式，但不提供 VS Code 二进制/API 兼容层。

| 熟悉的概念                                | Cachalot 当前实现                                             | 迁移时注意                                                                |
| ----------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 清单与贡献点                              | `publisher/name/version/engines/activationEvents/contributes` | 使用 `engines.cachalot`；贡献结构以本项目类型为准                         |
| `activate(context)` / `deactivate()`      | 每次激活创建独立作用域                                        | 安装插件运行在 Worker，停止可被限时终止                                   |
| `commands`、`window`、`workspace`         | 通过传入的 `context` 访问                                     | 没有全局 `vscode` 对象                                                    |
| `Disposable`、`subscriptions`             | SDK 注册由宿主自动跟踪                                        | 自建 Worker 资源用 signal 或 deactivate 清理，见生命周期说明              |
| `globalState`、配置                       | 插件 ID 命名空间，持久保存                                    | 读取也是异步；当前配置值只支持字符串                                      |
| TreeDataProvider / WebviewViewProvider    | 通用工作台负责呈现                                            | `TreeItem` 使用普通对象；Webview 没有 `acquireVsCodeApi` / `asWebviewUri` |
| `extensionDependencies` / `extensionPack` | 硬依赖与独立安装组合                                          | 本地补齐，不自动下载；依赖声明是 ID 数组                                  |
| 插件公开 exports                          | `context.extensions.getExtension(id)`                         | 只能访问声明的硬依赖，跨 Worker 方法按异步使用                            |
| Restart extensions                        | 重载插件及受影响消费者                                        | 不刷新应用，不重启本体，不取消本体聊天                                    |

## 开发路线

1. 跟随[入门教程](extension-api/get-started.md)，打包并安装一个阅读工具。
2. 查[清单参考](extension-api/manifest.md)，声明最小能力、命令、视图和激活条件。
3. 按任务阅读视图、阅读交互或模型指南；参数与返回值查[API 参考](extension-api/api-reference.md)。
4. 用[生命周期指南](extension-api/lifecycle.md)处理取消、更新、依赖失败与状态保留。
5. 完成[打包验证](extension-api/packaging.md)与[交互设计检查](extension-api/ux-guidelines.md)，再向用户分发本地包。

SDK 尚未发布 npm 包，当前打包器识别 `cachalot` 入口。类型开发使用本地仓库映射，步骤见教程。`cachalot/react` 及 [src/sdk/react.tsx](../src/sdk/react.tsx) 只用于可信内置模块；安装插件不能取得宿主 HTMLElement。

## 运行与信任边界

社区主代码在 opaque-origin iframe 启动的独立 Blob Worker 中执行，通过明确列出的消息桥访问 SDK；不在本体 UI 线程执行。Webview HTML 是另一层 sandbox 视图。能力声明、命名空间与数据校验约束宿主操作；代码不接触真实 API Key、Tauri 命令或任意宿主路径。

这不是完整的恶意代码防护或操作系统资源配额。Webview 自身导航目前未作为强网络隔离实现，包也没有签名验证。只安装可信发布者的代码。细节和限额见[打包与运行边界](extension-api/packaging.md#运行边界)。

## 现有样例与本体实现

- [reader-tools](../examples/reader-tools/README.md)：可实际打包安装的社区样例。
- [选区翻译](../src/extensions/selection-translation/manifest.ts)：可信内置插件，展示阅读工具、动作、结果与设置。
- [测试夹具](../tests/fixtures/extension-packages.ts)：独立 IIFE、依赖 API、资源、Webview、流式模型及故障样例，只用于隔离测试。
- [宿主架构](architecture.md#本地插件安装与依赖生命周期)：修改本体时查阅，不作为社区插件导入入口。
