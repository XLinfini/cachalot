# 打包、测试与分发

[插件开发](../extensions.md) · 相关：[清单](manifest.md)、[插件管理](../user-guide/extensions.md)

## 开发循环

编辑源文件 → 类型检查 → 打包 → 在隔离数据环境安装 → 打开相应文档/视图 → 更新或重启插件。源码热更新本体与更新已安装 Worker 代码不是同一种流程。

仓库示例可直接执行：

```sh
npm run test:types
npm run extension:pack -- examples/reader-tools /tmp/example.reader-tools.cachx
```

独立目录传给同一打包器；其依赖需先在开发环境准备好。打包器不会执行该插件的 npm scripts 或自动安装依赖。

## 打包器契约

[package-extension.ts](../../scripts/package-extension.ts) 读取源 package.json，用 esbuild 将入口、第三方库和 SDK 纯工具合并为浏览器 IIFE，导出全局 `cachalotExtension`。包内 main 改为 `extension.js`。

- `cachalot` 入口由工具识别；SDK 尚未发布 npm 包，类型工程需要本地映射。
- 源码类型导入会移除，运行依赖应打入入口，不保留外部 runtime import。
- Node 原生模块不属于浏览器运行环境；`cachalot/react` 被拒绝，社区 UI 使用 Webview。
- `files` 只列需要的包内资源文件或目录；不要将 node_modules、真实凭据、模型权重或测试输出列入。
- 资源路径须留在开发目录内，不接受路径穿越或符号链接资源。

## 安装包布局

```text
example.reader-tools.cachx   ZIP 格式
  package.json              已校验的插件清单
  extension.js              独立 IIFE 入口
  assets/note.txt            可选资源
  README.md                 可选使用说明
```

纯 `extensionPack` 可以没有 extension.js。`.zip` 也接受同一格式，不支持 VS Code 的 VSIX 布局或任意源码目录安装。

## 资源读取

`context.resources.read(path)` 异步返回副本 Uint8Array。只能读本包已有安全相对路径，不访问任意宿主文件。

```ts
import type { ExtensionContext } from "cachalot";

export async function readNote(context: ExtensionContext) {
  const bytes = await context.resources.read("assets/note.txt");
  return new TextDecoder().decode(bytes);
}
```

源清单需将对应文件列入 files。Webview 没有 asWebviewUri，图片可将字节编码为 data URL；库和样式应内联或按当前允许的方式组织，不通过外部脚本 URL 放宽 CSP。

## 包校验与限额

| 项目           | 当前上限 |
| -------------- | -------- |
| 压缩包大小     | 16 MiB   |
| 单文件展开大小 | 8 MiB    |
| 展开合计       | 32 MiB   |
| 文件条目       | 128      |
| package.json   | 128 KiB  |
| Webview HTML   | 4 MiB    |

安装器在可终止的独立 Worker 解析 ZIP，检查中央目录与局部入口、长度、CRC、重复路径、路径穿越、加密和符号链接等。当前不支持跨卷、ZIP64 或 ZIP 目录条目；打包器生成的是文件条目。UTF-8 清单与入口必须可解码。

内容 SHA-256 用于记录身份，不是签名。所有包先解析校验，再生成依赖计划并事务写入独立安装目录；检查失败不更改代码目录。激活失败时目录可能保留新版本，不提供自动版本回滚 UI。

## 运行边界

社区代码运行在 opaque-origin iframe 启动的 Blob Worker，主代码不在 UI 线程，也没有 document、Tauri、同源 IndexedDB 或任意网络访问。操作通过限定 SDK 桥校验能力、归属和展示数据。树与 Webview 是社区视图入口。

当前约束还包括每插件最多 1,024 个桥注册、最多 256 个待完成 RPC、每秒 2,000 个入站 SDK 消息、激活 15 秒超时；宿主发起的 RPC 调用有 120 秒上限。心跳停滞在可见窗口中检测并终止，隐藏窗口避免因节流误判。正常停止最多等待 deactivate 250 ms。

这些限额不是操作系统内存配额，也不是对恶意代码的完整保证。Webview 自身导航尚未成为强网络沙箱，签名与发布者认证未实现，只分发和安装可信代码。Chromium 验证不替代目标桌面 WebKit 或 iPad 的实际验证。

## 测试和发布检查

| 验证       | 至少确认                                                |
| ---------- | ------------------------------------------------------- |
| 清单与类型 | 当前引擎范围、精确贡献 ID、最小能力、依赖 API 协议      |
| 安装与更新 | 首次安装、同 ID 更新、缺失包、循环、版本提示            |
| 阅读交互   | 当前页、缩放、反向拖动、无结果、用户已选文字模式        |
| 生命周期   | 关闭视图、取消请求、停用/启用、重启、无重复注册         |
| 本体保持   | PDF、分析会话和本体聊天不被插件更新重置                 |
| 视图与数据 | 中英文、适合横屏宽度、错误反馈、不执行论文/模型输出     |
| 依赖故障   | 提供者失败/更新、消费者重启、级联管理、其他插件不受牵连 |
| 生产与平台 | 用生产构建重测，按实际分发平台验证 Worker/CSP           |

宿主的测试边界和夹具见[测试维护指南](../../tests/README.md)。仅在自己的隔离浏览器 profile/数据环境试装，不把测试故障包写进真实文献库环境。

当前分发方式是向用户提供 `.cachx`、清单版本、所需依赖包、使用说明和许可；没有市场发布命令、自动下载或自动更新。
