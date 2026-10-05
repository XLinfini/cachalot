# 阅读工具插件示例 / Reader tools example

在 Cachalot 仓库根运行 / Run from the Cachalot repository:

```sh
npm run extension:pack -- examples/reader-tools /tmp/example.reader-tools.cachx
```

在设置 → 插件选择这个包并确认安装，无需重启软件。独立插件工程可使用 `import type { ExtensionContext } from "cachalot"`（打包器识别该 SDK 入口；npm SDK 尚未发布）。本例为在仓库内获得类型检查而使用相对 SDK 导入。

Install this package through Settings → Extensions. No application restart is needed. Standalone projects may import types from `cachalot`; the packaging tool resolves that SDK entry. The SDK has not yet been published to npm. This in-repository example uses a relative SDK import for type checking.
