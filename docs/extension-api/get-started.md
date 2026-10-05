# 第一个插件

[插件开发](../extensions.md) · 下一步：[清单参考](manifest.md)、[视图与工作台](views.md)

本教程使用仓库内的 `example.reader-tools`。它改变阅读背景、注册一个“回到首页”树节点和状态项，不需要远端模型。完成后能从本地包安装、打开论文观察效果、停用并更新插件。

## 目录与环境

先按[快速开始](../get-started.md)启动浏览器预览或桌面应用。在仓库根阅读以下文件：

```text
examples/reader-tools/
  package.json    插件身份、贡献和源入口
  extension.ts    activate(context)
  README.md       打包与安装说明
```

仓库示例使用 `../../src/sdk` 作为类型入口，参与 `npm run test:types`。独立项目可用 `import type { ExtensionContext } from "cachalot"`，并在自己的 tsconfig 中将 `paths.cachalot` 映射到本地 Cachalot 仓库的 `src/sdk/index.ts`。这只是类型解析，当前不能把 `npm install cachalot` 当作已经发布的 SDK 安装步骤。

## 用脚手架创建独立项目

在 Cachalot 仓库运行：

```sh
npm run extension:create -- /tmp/my-extension example.my-extension
```

目标目录必须不存在；工具不会覆盖已有项目。它生成双语清单、src/extension.ts、tsconfig、package.json，以及自包含的 sdk/ 类型与纯工具，不留下指向本体源码的绝对路径。生成项目中运行 npm install 与 npm run check；依赖中 cachalot 使用本地 file:./sdk。

打包仍从 Cachalot 仓库运行：

```sh
npm run extension:pack -- /tmp/my-extension /tmp/example.my-extension.cachx
```

安装后打开命令面板执行“你好”。SDK 未发布 npm 包，不使用 npm install cachalot 从公共 registry 获取它。已有项目可用 npm run extension:sdk -- /tmp/cachalot-sdk 单独导出 SDK；或继续使用下面的源码类型映射。

## 手动配置独立项目的类型检查

若插件目录与 Cachalot 仓库并列，例如 cachalot/ 和 my-extension/，在插件目录安装 TypeScript 开发依赖：

```sh
npm install --save-dev typescript
```

在 my-extension/tsconfig.json 保存以下配置；目录关系不同时修改 paths 中的相对路径。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": { "cachalot": ["../cachalot/src/sdk/index.ts"] }
  },
  "include": ["extension.ts"]
}
```

插件目录运行 `npx tsc --noEmit`。打包命令仍从 Cachalot 仓库运行，将输入改为 `../my-extension`；打包器处理运行入口，TypeScript 的 paths 只处理类型与模块查找。

## 清单先声明贡献

下面是可完整校验的源清单形状。源入口可指向 TypeScript；打包后的入口由工具改成 JavaScript。

```json
{
  "publisher": "example",
  "name": "reader-tools",
  "version": "0.1.0",
  "displayName": { "zh": "阅读工具示例", "en": "Reader tools example" },
  "description": {
    "zh": "背景、树和状态栏示例。",
    "en": "Background, tree and status bar example."
  },
  "engines": { "cachalot": "^0.1.0" },
  "main": "extension.ts",
  "activationEvents": ["onDocumentOpen"],
  "capabilities": ["documents.read", "reader.interact", "reader.decorate"],
  "contributes": {
    "commands": [
      {
        "command": "example.reader-tools.first-page",
        "title": { "zh": "回到首页", "en": "First page" }
      }
    ],
    "views": [
      {
        "id": "example.reader-tools.pages",
        "title": { "zh": "阅读工具", "en": "Reader tools" },
        "location": "sidebar.left"
      }
    ]
  }
}
```

`documents.read` 用于当前文档 ID，`reader.interact` 用于导航，`reader.decorate` 用于背景。视图本身不额外要求这三种权限。

## 注册实现

命令和视图必须与清单 ID 一致；树项可以用自己的局部稳定 ID。

```ts
import type { ExtensionContext } from "cachalot";

export function activate(context: ExtensionContext) {
  context.reader.setBackground("#e7eef8");
  context.commands.registerCommand("example.reader-tools.first-page", () => {
    const id = context.reader.activeDocumentId;
    if (id) context.reader.revealPage(id, 1);
  });
  context.window.registerTreeDataProvider("example.reader-tools.pages", {
    getChildren: () => [
      {
        id: "first",
        label: { zh: "回到首页", en: "First page" },
        command: { command: "example.reader-tools.first-page" },
      },
    ],
  });
  context.window.showView("example.reader-tools.pages");
  const status = context.window.createStatusBarItem("example.reader-tools.status", "right");
  status.text = { zh: "阅读工具已就绪", en: "Reader tools ready" };
  status.command = "example.reader-tools.first-page";
  status.show();
}
```

宿主自动跟踪 SDK 返回的注册资源，停用时释放背景、命令、视图和状态项。对自己的计时器、订阅和异步业务使用 `context.signal` 或 `deactivate`，见[生命周期](lifecycle.md)。

## 打包并安装

```sh
npm run extension:pack -- examples/reader-tools /tmp/example.reader-tools.cachx
```

Windows 可换成自己可写的输出路径。工具将代码与依赖合并为 IIFE，生成 `.cachx`，并运行与生产安装器相同的包校验。

在应用的“设置 → 插件”选择输出包，确认权限并安装。因为它使用 `onDocumentOpen`，打开一篇 PDF 后才观察树侧栏、背景和状态项。点击树项应回到第一页。

## 验证生命周期

1. 切换中英文界面，树和状态项应显示相应标签。
2. 停用插件，背景、侧栏和状态项应释放，本体仍可阅读与问答。
3. 重新启用，注册不应重复出现。
4. 修改背景或标签，提升清单版本，重新打包安装；预览应显示版本变化，无需重启应用。
5. 重启该插件，验证当前 PDF 与本体聊天继续存在。

当前没有 F5 自动开启 Extension Development Host、插件 CLI 安装或源码热替换协议。开发循环是编辑 → 打包 → 本地安装/更新；用目标浏览器或 Webview 的开发工具调试 Worker 与消息桥错误。

继续阅读：[贡献字段](manifest.md)、[Webview 与设置视图](views.md)、[包资源](packaging.md)、[完整 API](api-reference.md)。
