# 文档与阅读交互

[插件开发](../extensions.md) · 相关：[数据契约](../document-analysis.md)、[API 参考](api-reference.md)

## 选择合适的输入

| 数据                 | 用途                                             |
| -------------------- | ------------------------------------------------ |
| `PageFacts`          | 来源字符、字形、递归绘制树与可解析资源；精确证据 |
| `LayoutObservations` | 原始模型类别与检测框；核对预测                   |
| `DocumentSemantics`  | 段落、章节、公式归属、关系和全文阅读顺序         |
| `SemanticPageView`   | 当前文档语义在单页上的临时投影；交互最常用       |

通过 `context.documents` 取得这些数据，`documents.read` 控制主动读取。原有 get* 便捷调用绑定当前阅读器会话；API 0.1.3 的 openDocument(id) 可按已知文献库 ID 创建独立句柄，关闭或切换标签后仍能处理全文，不提供文献库扫描或任意文件 API。返回复制的数据，不写回权威语义；普通 DocumentSemantics 快照可能只覆盖部分页。长任务与全文完成判定见[PDF 任务指南](pdf-artifacts-and-comparison.md#独立于阅读器的文档句柄)。

```ts
import type { ExtensionContext } from "cachalot";

export async function activate(context: ExtensionContext) {
  const id = context.reader.activeDocumentId;
  if (!id) return;
  const page = await context.documents.getSemanticPage(id, 1);
  const structure = page.document;
  if (!structure.coverage.complete) {
    const missingPages = structure.coverage.missingPages;
    // Show partial coverage in your own view; do not treat it as a full document.
    console.debug("Missing pages", missingPages);
  }
}
```

此清单需 `documents.read`。不要只在 activate 读一次就认为所有页完整；监听 activeDocument 和 documents.onDidChangeDocument，按 documentId 和 revision 更新本地业务状态。

API 0.1.4 增加 schemaVersion 2 的 `PageFacts.graphics`、字符来源对象/原生矩阵，以及 `DocumentHandle.readResource` / `pdf.resolveResource`。资源包含原生页/对象 PDF、字体程序及图片流，正文与公式的解释继续使用 DocumentSemantics。坐标、嵌套 Form 保留范围、来源生命周期和重建示例见[原生绘制事实与资源](pdf-resources.md)。

## 当前阅读位置

context.reader.viewState 返回当前原文的阅读状态副本；documents.read 控制读取及 onDidChangeViewState 订阅。字段为 documentId、page、pageCount、zoom、scrollTop、viewportHeight，以及可选 viewId、anchor `{page, fraction}`、cause（user/navigation）。页码从 1 开始，zoom 为缩放倍数，滚动和视口高度是阅读容器 CSS 像素；anchor 为阅读线在显示页上的归一化位置。

状态在 PDF 容器挂载后发布，未就绪及关闭/切换文档时可为 null；不能假定 activeDocument 事件同步包含位置。滚动、缩放、尺寸变化都会触发状态事件，插件按自己的需要去重或节流，避免每个滚动事件调用 LLM。

```ts
const state = context.reader.viewState;
if (state) console.debug(state.documentId, state.page);
context.reader.onDidChangeViewState((next) => {
  if (next) console.debug(next.page, next.zoom);
});
```

当前书签可保存 documentId 与 page，再通过 revealPage 导航。scrollTop 是当前布局下的值，不能直接作为跨设备稳定锚点；比较句柄的 reveal 使用页码和归一化 fraction，不接收任意滚动像素。公开示例见[bookmarks](../../examples/bookmarks/README.md)。

## PDF 产物与并列视图

API 0.1.3 提供原生区域裁切、PDF 合成、独立产物保存及 openPdfComparison。左侧继续是活动文献，右侧是本插件自己的任意 PDF：只显示、选择文字和复制，不分析、不继承左侧语义、不接入框选翻译。需要分析时用户把产物重新导入文献库。

对应关系由插件显式提供，可有一个原段落对应多个目标页区域；没有关系时默认不联动。getViewStates/onDidChangePaneState 提供多个阅读区域，旧 viewState 仍只表示原文。详细生成路线、复杂行内公式复用与生命周期见[PDF 产物与并列阅读](pdf-artifacts-and-comparison.md)。

## 坐标与身份

页码从 1 开始。`Box` 为显示页面归一化 `[left, top, right, bottom]`，不包含 CSS 像素、缩放或额外旋转；字符索引从 0 开始，仅在对应页和 factsKey 下有意义。

`ReaderSelection` 使用 `x/y/width/height`，不是 Box 数组。公式、节点及字符身份与分析版本绑定，不能持久保存一个块 ID 后跨任意版本套用。保留 documentId、page、factsKey 与来源信息，再验证版本，详见[来源契约](../document-analysis.md#来源与坐标)。

## 阅读背景与覆盖框

`setBackground(color)` 返回可释放背景注册，`setDecorations(documentId, page, decorations)` 注册该页覆盖框；二者需要 `reader.decorate`。dispose 后恢复没有该注册时的状态，不直接改本体 DOM。

每个 ReaderDecoration 有 id、Box、borderColor，可附背景色和文字标签。重算覆盖框时释放旧注册再建立新注册，避免堆积。颜色使用宿主支持的普通 CSS 颜色格式，背景优先选 hex。

## 自定义矩形工具

工具用 `reader.interact` 注册，不另加清单工具数组。preview 只提供命中覆盖框，select 决定结果；均可异步。以下是手势预览示例，不会自动取得正文，也没有完整段落策略：

```ts
import type { ExtensionContext } from "cachalot";
import { selectionPreview } from "cachalot";

export function activate(context: ExtensionContext) {
  context.reader.registerInteractionTool({
    id: "example.region.tool",
    title: { zh: "区域预览", en: "Region preview" },
    mode: "rectangle",
    preview: (_page, box) => [
      {
        id: "candidate",
        box,
        borderColor: "#8b5cf6",
        backgroundColor: "#8b5cf633",
      },
    ],
    select: (_page, gesture) => selectionPreview(gesture),
  });
}
```

如果实现段落翻译，应使用页面语义、完整包围判断和明确输出范围；不要用上述任意矩形预览当作完整段落。`reader.interact` 的工具与悬停回调会收到含文字的 SemanticPageView。

宿主维护蓝色原始手势框和异步代次，迟到 preview/select 不覆盖新选择。用户还未主动选模式时可跟随首个可用工具；后来激活的工具不能覆盖用户已选的文字模式。

## 选区动作

`registerSelectionAction` 提供 id、title、可选 when、run。when 可返回异步布尔值，只控制动作可见性；run 接收选区和取消 signal。处理范围以 ReaderSelection 和自己的来源验证为准，不用更广背景悄悄补全文字。

文字模式保留 DOM 字符索引。矩形工具自己决定实际单元与文字；本体不读取翻译业务 DTO。

## 悬停与导航

`registerHoverProvider` 接收页面、归一化点和 signal，返回 Label 或 null。鼠标移动、页面变化或插件停用时，应放弃迟到结果。耗费模型请求时先做命中、缓存与取消，不对每个 pointermove 无条件调用 LLM。

`revealPage(documentId, page)` 使用 `reader.interact` 跳转；读取当前文档 ID 另需 `documents.read`。它不替代未知文件打开接口，也不读取操作系统任意路径。

下一步：[模型调用](ai-and-formulas.md)、[交互设计](ux-guidelines.md)。
