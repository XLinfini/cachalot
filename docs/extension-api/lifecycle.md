# 生命周期与依赖

[插件开发](../extensions.md) · 相关：[清单](manifest.md)、[插件管理](../user-guide/extensions.md)

## 一次激活对应一个作用域

宿主在启动、文档打开、命令或硬依赖请求满足条件时调用 `activate(context)`。它可以异步返回，也可以返回供消费者使用的公开 API。注册命令、工具、视图和事件时宿主记录归属；激活失败会撤销已注册内容。

每次重新启用、更新或重启都创建新作用域，不复用旧的 context。不要把旧 context 或依赖 API 代理保存成跨重载全局单例。

## 状态参考

| 状态         | 含义                                 |
| ------------ | ------------------------------------ |
| `inactive`   | 已安装并启用，尚未请求/满足激活条件  |
| `activating` | 正在激活或等待依赖                   |
| `active`     | 激活完成，exports 可用               |
| `disabled`   | 用户停用                             |
| `blocked`    | 缺失、停用、循环或失败的依赖阻止激活 |
| `error`      | 本插件的加载、注册或运行适配器失败   |

依赖诊断包括问题类型和路径。某个插件失败不应通过重启本体恢复；更新修复包或重启插件即可重建其作用域。

## Disposable 与自建资源

所有 **SDK 返回的注册资源**自动跟踪，手动 dispose 幂等。用 `context.subscriptions` 保存这些句柄也允许。可信内置模块的 subscriptions 在停止时由宿主释放；社区 Worker 自己创建的任意 Disposable 不会被逐个送往宿主执行，应明确监听 `context.signal` 或在 `deactivate` 清理。

```ts
import type { ExtensionContext } from "cachalot";

export function activate(context: ExtensionContext) {
  const item = context.window.createStatusBarItem("example.clock.status", "right");
  item.show();
  const timer = setInterval(() => {
    if (!context.signal.aborted) item.text = new Date().toLocaleTimeString();
  }, 1000);
  context.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
}
```

上例清单须使用 `publisher: example`、`name: clock`。状态项是动态注册，不需要额外贡献声明。

停止先取消宿主作用域并释放注册。社区 Worker 的正常停止会调用 `deactivate`，最多等待 250 ms 后终止；可信模块也采用有界等待。不能依赖 deactivate 最后一次调用宿主写入状态或等待长请求：当时旧 context 已经被取消。重要持久数据应在业务操作成功时写入。

## 请求与视图取消

`context.signal` 代表插件作用域；`ViewHandle.signal` 代表某次视图实例。LLM 与 OCR 接收请求 signal，宿主组合插件与请求信号。视图关闭取消视图任务，停用取消插件任务，迟到结果不会继续进入已失效的作用域。

自建计算仍要检查信号；终止 Worker 只能停止当前实例，不保证后台任务完成。页面分析是本体共享任务，不因为一个插件停用就销毁整个文档会话。

## 硬依赖和插件组合

`extensionDependencies` 采用插件 ID 数组。宿主在开始任何激活 Promise 前检查可达依赖图；提供者先激活，共享依赖只激活一次。缺失、停用、循环或失败阻止消费者，其他不相关插件继续运行。

`extensionPack` 只组织安装。新组合所需成员应在同一批本地包或已安装目录中可用，但成员不是运行依赖；删除组合不删除成员。只有纯组合可以省略 main，若同时声明硬依赖，硬依赖规则仍适用。

## 使用公开 API

提供者返回方法对象，消费者清单声明 `extensionDependencies: ["example.provider"]`，然后通过 SDK 访问。两个例子属于各自独立入口。

```ts
import type { ExtensionContext } from "cachalot";

export function activate(_context: ExtensionContext) {
  return {
    async describe(documentId: string) {
      return `Description for ${documentId}`;
    },
  };
}
```

```ts
import type { ExtensionContext } from "cachalot";

export async function activate(context: ExtensionContext) {
  const dependency = context.extensions.getExtension<{
    describe(documentId: string): Promise<string>;
  }>("example.provider");
  if (!dependency) throw new Error("Missing example.provider");
  const api = await dependency.activate();
  const id = context.reader.activeDocumentId;
  if (id) await api.describe(id);
}
```

消费者读当前文档 ID 还需 `documents.read`。正常激活顺序已保证提供者 active，可直接读取 `.exports`；`.activate()` 适合显式取得同一服务。未声明依赖的访问被拒绝。

跨 Worker 方法一律按异步调用。数据使用普通 JSON 对象/数组和 Uint8Array；不传 DOM、类实例、Map/Set、共享可变对象。类型参数只是编译提示，不替代双方的运行时协议与版本检查。

## 更新、停用、卸载与恢复

- 更新或单个重启先停止消费者，再停止提供者；恢复按依赖顺序重新激活，消费者取得新 API。
- 停用提供者前显示启用消费者，用户确认后级联停用；启用消费者会启用需要的已安装依赖。
- 卸载提供者时包括停用消费者；内置消费者阻止卸载。
- 运行适配器故障或 Worker 无响应会停止该插件和消费者，消费者显示依赖失败。
- 补装缺失依赖后会重试已请求激活的消费者；局部更新/重启不会顺带重试无关失败插件。

设置和 globalState 在停用、重启、卸载后保留。安装代码与状态不是可再生论文缓存。本体阅读和聊天生命周期独立于这些操作。
