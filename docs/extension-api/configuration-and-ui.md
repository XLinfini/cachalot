# 配置与公共交互

[插件开发](../extensions.md) · 相关：[清单](manifest.md)、[API 参考](api-reference.md)、[生命周期](lifecycle.md)

简单配置与临时交互由宿主统一呈现，复杂结果仍使用树或 Webview。公共服务在社区 Worker 和内置插件中使用相同 SDK。

## 声明有类型的配置

```json
{
  "configuration": [
    {
      "key": "enabled",
      "type": "boolean",
      "default": true,
      "title": { "zh": "启用书签", "en": "Enable bookmarks" }
    },
    {
      "key": "limit",
      "type": "integer",
      "default": 20,
      "minimum": 1,
      "maximum": 100,
      "title": { "zh": "结果数量", "en": "Result count" }
    },
    {
      "key": "style",
      "type": "string",
      "default": "brief",
      "enum": ["brief", "detailed"],
      "title": { "zh": "风格", "en": "Style" }
    }
  ]
}
```

type 支持 string、number、integer、boolean、array、object。enum 限定可选值，minimum/maximum 仅用于数值。array/object 接受 JSON，不支持嵌套 schema、正则或异步校验。默认值在安装前校验，写入在宿主再次校验。配置最多 1 MiB JSON，深度最多 32 层。

未声明 type 的旧配置继续使用字符串与旧的原始字符串存储格式，不要求内置翻译插件迁移。已声明类型的配置按 JSON 保存；不能解析或不符合 schema 的旧值回退为声明默认值，不静默改写原存储。

“设置 → 插件”自动显示声明字段：布尔复选框、数值输入、enum 下拉、字符串或 JSON 编辑。每字段点击保存提交，也可恢复默认；未保存草稿不对外发布。复杂工作流可以另外注册 settings 视图。

## 读取、更新与变化通知

```ts
const settings = context.workspace.getConfiguration();
const enabled = await settings.get<boolean>("enabled");
const changed = context.workspace.onDidChangeConfiguration((event) => {
  if (event.key === "enabled") {
    // event.value contains the committed value for this extension.
  }
});
await settings.update("enabled", false);
```

get 是异步的，类型参数用于 TypeScript，不绕过运行时 schema。读写已声明的 key；读取未知 key 时只有显式提供 fallback 才返回该 fallback，否则拒绝。已声明配置使用持久值或声明 default。读写只属于本插件。相同值不重复发事件，变化在持久写入成功后发布；设置界面和插件 API 共享同一写入队列。标量配置也进入 config.publisher.name.key 上下文，供菜单、快捷键与 enablement 使用。

监听句柄由宿主跟踪，也可自行 dispose。不要把草稿、访问令牌或大份论文内容写入配置；插件业务数据用 globalState，凭据由本体模型服务管理。

## 选择与输入

```ts
const selected = await context.window.showQuickPick(
  [
    { id: "brief", label: { zh: "简要", en: "Brief" } },
    { id: "detailed", label: { zh: "详细", en: "Detailed" } },
  ],
  { title: { zh: "选择风格", en: "Choose style" } },
  context.signal,
);

if (!selected) return;
const name = await context.window.showInputBox(
  {
    title: { zh: "结果名称", en: "Result name" },
    prompt: { zh: "可使用简短标题", en: "Use a short title" },
    value: "Summary",
  },
  context.signal,
);
if (name === undefined) return;
```

QuickPickItem 是 id、label、可选 description 的普通对象。结果返回选中的项目；输入返回字符串。用户取消返回 undefined；调用信号取消或插件停止以 AbortError 拒绝。输入可声明 password 隐藏显示，但不因此成为密钥持久化 API。

对话框排队呈现，保留焦点并支持 Escape、Tab；QuickPick 可搜索、用 Enter 选择第一项。当前不支持多选、输入实时校验或完整 VS Code QuickInput 对象。宿主最多保留 16 个待处理对话框，每次最多 500 个选项。

## 通知与进度

```ts
context.window.showInformationMessage("Ready");
context.window.showWarningMessage("Partial analysis");

await context.window.withProgress(
  { title: { zh: "整理结果", en: "Preparing results" }, cancellable: true },
  async (progress, signal) => {
    progress.report({ message: "Loading", increment: 10 });
    // Pass signal to asynchronous SDK services.
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    progress.report({ increment: 90 });
  },
);
```

进度 increment 为增量百分比，累积显示限定在 0–100。withProgress 返回 task 的结果；完成或失败自动移除进度条。cancellable 为 true 时用户可取消，signal 同时包含插件停止信号；插件代码应响应取消、放弃迟到结果。取消不是强制中断任意 JavaScript 计算。

通知为普通文本，可关闭；每次激活所属通知在停用时清理。最多 20 条通知、32 个进度任务。社区调用还受[消息桥 RPC 时限](packaging.md#运行边界)约束；当前不是无限时后台任务接口。showErrorMessage 继续使用原宿主错误通道。
