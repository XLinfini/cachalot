# Reading Bookmarks / 阅读书签

完全使用公开 SDK 的社区插件示例：读取阅读位置、输入书签名称、持久化、树视图、快捷键、类型化设置和公开 API。

在仓库根目录运行：

```bash
npx tsc --noEmit -p examples/bookmarks/tsconfig.json
npm run extension:pack -- examples/bookmarks /tmp/example.bookmarks.cachx
```

在插件设置页安装生成的包，打开论文后点击“添加阅读书签”，或使用 Ctrl+Alt+B（macOS 为 Cmd+Alt+B）。关闭“启用添加书签”后，菜单中的命令禁用。数据按文档 ID 存储，侧栏只显示当前论文的书签。

This example uses only the public SDK. Install the packaged extension and use Add Reading Bookmark or Ctrl+Alt+B / Cmd+Alt+B. Its tree displays bookmarks for the current paper; saved data survives extension restarts.
