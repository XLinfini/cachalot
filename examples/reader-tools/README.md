# 阅读工具插件示例 / Reader tools example

[第一个插件教程 / Tutorial](../../docs/extension-api/get-started.md) · [API 参考 / API reference](../../docs/extension-api/api-reference.md)

本例演示背景、树侧栏、首页导航命令和状态项。清单使用 onDocumentOpen，打开 PDF 后观察效果；不需要模型服务。停用会释放所有注册，重新启用不重复注册。

This example contributes a reading background, a tree sidebar, a first-page command and a status item. Open a PDF to trigger onDocumentOpen. It needs no model service. Disabling it releases the contributions.

## 打包与安装 / Package and install

在 Cachalot 仓库根运行 / Run from the Cachalot repository:

```sh
npm run extension:pack -- examples/reader-tools /tmp/example.reader-tools.cachx
```

在“设置 → 插件”选择这个包并确认安装，然后打开 PDF。独立插件工程可使用 `import type { ExtensionContext } from "cachalot"`，打包器识别此 SDK 入口；npm SDK 尚未发布。本例为在仓库内获得类型检查而使用相对 SDK 导入。

Install through Settings → Extensions, then open a PDF. Standalone projects may import types from cachalot; the packaging tool resolves that SDK entry. The SDK has not yet been published to npm. This in-repository example uses a relative SDK import for type checking.

## 修改与验证 / Edit and verify

修改 extension.ts 后提升 package.json 的版本，重新打包安装。切换中英文、点击首页节点、停用/启用与重启插件；检查背景和视图释放、当前 PDF 与本体问答保留。无需重启应用。

After editing extension.ts, increase the manifest version, package again and install the update. Check both languages, first-page navigation, disable/enable and extension restart. The PDF and core chat should stay open; no application restart is required.

深入参考 / Further reading: [清单 / Manifest](../../docs/extension-api/manifest.md)、[生命周期 / Lifecycle](../../docs/extension-api/lifecycle.md)、[打包 / Packaging](../../docs/extension-api/packaging.md)。
