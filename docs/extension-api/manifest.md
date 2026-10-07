# 清单参考

[插件开发](../extensions.md) · 相关：[生命周期](lifecycle.md)、[打包](packaging.md)

插件包根目录必须有 `package.json`。源目录的 `main` 可以指向 TS/JS；安装包的 `main` 必须是可解码的 UTF-8 `.js` IIFE 入口，导出全局 `cachalotExtension`。完整示例见[教程](get-started.md)。

类型定义在 [ExtensionManifest](../../src/sdk/index.ts)，运行校验在 [manifest.ts](../../src/infrastructure/extensions/manifest.ts)。以下规则对应当前 API 0.1.1。

## 身份、版本与入口

| 字段                    | 必须       | 格式与作用                                              |
| ----------------------- | ---------- | ------------------------------------------------------- |
| `publisher`             | 是         | 小写字母、数字、连字符                                  |
| `name`                  | 是         | 同上；ID 为 `publisher.name`，合计最长 128 字符         |
| `version`               | 是         | 有效 SemVer；更新和降级比较使用此值                     |
| `displayName`           | 是         | 非空字符串或 `{zh, en}`；面向用户                       |
| `description`           | 是         | 同上；描述实际功能                                      |
| `engines.cachalot`      | 是         | 包含宿主 API 版本的有效 SemVer 范围，不允许完全通配 `*` |
| `main`                  | 通常是     | 包内安全相对路径；只有非空 `extensionPack` 组合可省略   |
| `activationEvents`      | 是         | 受支持事件数组，可以为空                                |
| `capabilities`          | 是         | 能力数组，可以为空，不重复                              |
| `extensionDependencies` | 否         | 硬依赖 ID 数组，不允许自身或重复 ID                     |
| `extensionPack`         | 否         | 安装组合 ID 数组，不允许自身或重复 ID                   |
| `contributes`           | 否         | 下述贡献对象                                            |
| `files`                 | 打包器选项 | 源目录资源文件/目录列表；不是运行时能力声明             |

名字不能含点或下划线；ID 例如 `example.reader-tools`。清单不能自行指定 `builtIn` 取得内置身份。额外的 npm 元数据不等于可用贡献点或 API。

`engines.cachalot` 约束宿主 API，不约束另一个插件的版本。依赖 ID 后不拼接 `@version`，当前没有依赖插件的版本范围字段；公开服务应自行设计版本化 API。

## 激活事件

| 值                                 | 行为                                               |
| ---------------------------------- | -------------------------------------------------- |
| `onStartupFinished`                | 宿主启动后激活                                     |
| `onDocumentOpen`                   | 打开文档时激活；已经打开文档的安装也按当前条件处理 |
| `onCommand:publisher.name.command` | 调用该插件已声明命令时激活                         |

命令事件必须对应 `contributes.commands` 中的同名命令。贡献声明不会自动替代所有激活事件；没有声明受支持事件的普通插件不会自动运行，仅作为其他插件的硬依赖时仍可被提前激活。

## 能力声明

| 能力              | 直接控制的调用                                                |
| ----------------- | ------------------------------------------------------------- |
| `documents.read`  | 文档读取与文档事件、当前文档 ID/事件、阅读状态、公式 PDF 裁剪 |
| `reader.interact` | 选区及事件、工具、动作、悬停和页码导航                        |
| `reader.decorate` | 阅读背景和覆盖框                                              |
| `ocr`             | 指定公式的复建服务                                            |
| `lm`              | 当前模型及事件、图像能力查询、流式模型调用                    |

工具/悬停的 `reader.interact` 回调会接收包含文字与语义的页面投影，它不是“只能看鼠标、不能看文档内容”的权限。选择最小能力，并在安装描述中说明内容使用目的。

视图、命令、状态、插件内配置和资源读取无需额外能力名，但仍受注册归属、作用域和包资源边界约束。能力不授予真实密钥、任意网络、OS 或本体 DOM 访问。

## 贡献点

| 字段              | 元素字段                                                                            | 规则                                                                     |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `commands`        | `command`, `title`, 可选 `category`, `enablement`                                   | ID 使用本插件前缀，在 activate 中注册处理函数                            |
| `menus`           | `location`, `command`, 可选 `when`, `group`                                         | reader.toolbar、reader.context、view.title、commandPalette；命令须已声明 |
| `keybindings`     | `command`, `key`, 可选 `mac`, `when`, `allowInInput`                                | 单组合快捷键；命令须已声明                                               |
| `viewsContainers` | `id`, `title`, `location`                                                           | location 为左右 sidebar 或 panel                                         |
| `views`           | `id`, `title`, `location`, 可选 `container`, `when`                                 | 五种位置；容器须存在且位置一致                                           |
| `configuration`   | `key`, `title`, `default`, 可选 `description`, `type`, `enum`, `minimum`, `maximum` | 类型与默认值校验；键在插件命名空间内保存                                 |

命令、视图、容器 ID 必须以 `publisher.name.` 开头，且这些贡献之间不能重复。工具、选区动作、状态项也用该前缀，但通过 SDK 动态注册，没有独立的清单数组。配置 key 在本插件内唯一，无需再写插件前缀。

`views` 位置为 `sidebar.left`、`sidebar.right`、`panel`、`settings`、`modal`。容器是归属元数据，当前工作台仍按位置和视图标签呈现，不等于另一个独立 Activity Bar。

双语标签的两个值都应是非空字符串；列表校验上限为 256 个元素。清单限制用于输入校验，不是鼓励插件占满工作台。

## 配置与条件表达式

声明配置后，宿主在插件设置卡片中自动生成字段。type 支持 string、number、integer、boolean、array、object；enum 和数值范围同时校验默认值与更新值。省略 type 的旧声明继续使用字符串。持久写入成功后触发本插件的配置变化事件，见[配置与公共交互](configuration-and-ui.md)。

enablement、when 使用同一声明式上下文语法，支持逻辑、等值比较与括号；非法表达式在安装前拒绝。菜单条件、视图条件和命令启用状态的区别见[命令与上下文](commands-and-context.md)。

## 常见清单错误

| 错误                                  | 修正                                      |
| ------------------------------------- | ----------------------------------------- |
| API 范围为 `*` 或排除 0.1.1           | 声明实际兼容范围，如 `^0.1.1`             |
| 注册未声明的命令/视图                 | 同步清单和注册，确认 ID 完全一致          |
| 容器不存在或位置不同                  | 在同一清单声明容器，保持 location 一致    |
| 用 npm 包名作为 extensionDependencies | 改成实际插件 ID；第三方库由构建器打入代码 |
| 将 Node 模块作为主入口运行            | 编译为当前浏览器 Worker 支持的独立包      |
| 仅改 API 范围绕过不兼容               | 按真实接口迁移代码并验证，不只修改字符串  |

下一步：[生命周期与依赖](lifecycle.md)、[API 参考](api-reference.md)。
