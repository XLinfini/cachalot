# 命令、菜单、快捷键与上下文

[插件开发](../extensions.md) · 相关：[清单](manifest.md)、[视图](views.md)、[API 参考](api-reference.md)

命令处理函数只注册一次，同一命令可供命令面板、菜单、快捷键、树节点和状态项使用。命令面板通过 Ctrl+Shift+P（macOS 为 Cmd+Shift+P）或阅读工具栏的搜索按钮打开，按标题、分类和 ID 搜索。声明但尚未激活的命令也可显示；执行时由宿主请求激活声明者，清单也可显式声明 onCommand 激活事件。

## 声明与注册

以下片段用于 ID 为 example.tools 的清单；导航还需 documents.read 与 reader.interact 能力。

```json
{
  "commands": [
    {
      "command": "example.tools.first",
      "title": { "zh": "回到首页", "en": "First page" },
      "category": { "zh": "阅读", "en": "Reader" },
      "enablement": "reader.documentOpen"
    }
  ],
  "menus": [
    {
      "location": "reader.toolbar",
      "command": "example.tools.first",
      "when": "reader.documentOpen"
    },
    { "location": "reader.context", "command": "example.tools.first", "group": "navigation" }
  ],
  "keybindings": [
    {
      "command": "example.tools.first",
      "key": "ctrl+alt+1",
      "mac": "meta+alt+1",
      "when": "reader.documentOpen && !inputFocus"
    }
  ]
}
```

```ts
context.commands.registerCommand("example.tools.first", () => {
  const id = context.reader.activeDocumentId;
  if (id) context.reader.revealPage(id, 1);
});
```

enablement 控制命令能否执行，包括直接 executeCommand 调用；when 只控制特定入口的显示或快捷键匹配。界面显示后状态仍可能变化，业务处理函数也应核对当前文档与自己的条件。

## 菜单位置

| location       | 位置与条件                          |
| -------------- | ----------------------------------- |
| reader.toolbar | 阅读工具栏                          |
| reader.context | PDF 阅读区域右键菜单                |
| view.title     | 工作台视图标题；when 可使用 view.id |
| commandPalette | 对指定命令额外限制命令面板可见性    |

没有 commandPalette 菜单声明的命令默认进入面板；声明后至少一条相应 when 成立才显示。group 按字符串排序，目前不实现 VS Code 的 @数字优先级或任意菜单扩展点。菜单引用必须属于同一插件的 commands 声明。

views 的 when 控制视图标签显示，按当前上下文重新评估；不作为销毁视图或停止后台任务的生命周期信号。清理仍依靠实例 signal 和插件作用域。

## 上下文条件

| 内置键                    | 值                                     |
| ------------------------- | -------------------------------------- |
| reader.documentOpen       | 是否打开文档                           |
| reader.documentId         | 当前文档 ID 或 null                    |
| reader.hasSelection       | 是否存在选区                           |
| reader.page               | 当前阅读页；未知时为 0                 |
| lm.available              | 是否存在本体当前模型                   |
| analysis.ready            | 当前文档已有语义发布；可能仅覆盖部分页 |
| config.publisher.name.key | 对应插件的标量配置值                   |
| view.id                   | 仅视图与视图标题菜单求值时提供         |
| inputFocus                | 仅快捷键求值时提供                     |

这些键用于入口判断，不授予文档或模型能力。要获取正文、模型或阅读状态，仍需 SDK 对应能力。analysis.ready 不保证全文分析已完成。

支持 !、&&、||、括号和 ==、!=、===、!==；支持字符串、数字、布尔与 null 比较。reader.documentId == 'abc' 与 example.tools.mode == text 都可用，比较右侧的裸词按字符串处理。未知键为空值，不支持函数、正则、大小比较、in 或 JavaScript。解析不执行代码，表达式最长 2048 字符。

插件用自己的 ID 前缀发布业务条件：

```ts
await context.commands.setContext("example.tools.busy", true);
try {
  // Run the operation.
} finally {
  await context.commands.setContext("example.tools.busy", false);
}
```

允许 string、有限 number、boolean 和 null，每插件最多 256 个键；不能覆盖内置键或别人的命名空间。停用和重启清理这次激活发布的键；配置键由宿主管理、随持久设置更新。

## 快捷键与用户覆盖

当前支持单个组合键，如 ctrl+alt+b、meta+shift+p、f5。修饰键为 ctrl、alt、shift、meta；普通键支持字母、数字、F1–F12、Enter、Escape、Space、Tab 和方向键。不支持多步 chord 或键盘布局扫描码。

默认避开输入框、文本域、select 和可编辑内容；只有明确声明 allowInInput: true 才可匹配。IME、重复按键和已经处理的按键不调用插件。相同组合按最后一条匹配声明处理；用户覆盖优先于默认绑定，仍检查命令 enablement。宿主命令面板组合键保留。

用户在命令面板切换到“键盘快捷键”，修改组合并离开输入框保存；“恢复默认”删除覆盖。覆盖是本机工作台偏好，不写回插件包。重启插件保留覆盖。

完整的外部使用者见[书签示例](../../examples/bookmarks/README.md)。
