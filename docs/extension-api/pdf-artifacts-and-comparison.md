# PDF 任务、产物与并列阅读

[插件开发](../extensions.md) · 相关：[API 参考](api-reference.md)、[文档分析](../document-analysis.md)、[生命周期](lifecycle.md)

这些接口从 API **0.1.3** 起提供。宿主负责来源读取、分析、PDF 资源操作、产物保存和阅读；翻译、目标排版、字体选择及任务恢复策略由插件实现。当前没有预装全文翻译插件。

## 声明能力

```json
{
  "engines": { "cachalot": "^0.1.3" },
  "capabilities": ["documents.read", "documents.write", "reader.interact", "lm"]
}
```

`documents.read` 允许取得文献来源和分析、检查 PDF、导出原生区域；`documents.write` 允许管理自己的二进制产物，PDF 合成同时要求 read 和 write；并列阅读还需要 `reader.interact`。纯文件处理不需要 `lm`，调用模型时才声明。能力不会授予任意文件路径或修改文献库原 PDF 的权限。

## 独立于阅读器的文档句柄

原有 `documents.getPageFacts(id, page)` 等便捷调用绑定当前阅读器会话。长任务使用 `documents.openDocument(id)`，按已知文献 ID 打开独立句柄，关闭标签或切换文献后仍能读取和分析该来源。此接口不提供文献库枚举或任意文件访问。

```ts
import type { ExtensionContext } from "cachalot";

export async function collectDocument(context: ExtensionContext, signal: AbortSignal) {
  const id = context.reader.activeDocumentId;
  if (!id) throw new Error("Open a document first");
  const handle = await context.documents.openDocument(id, signal);
  try {
    const snapshot = await handle.analyze({
      level: "layout",
      signal,
      onProgress: ({ phase, completed, total }) => {
        console.debug(phase, completed, total);
      },
    });
    const source = await handle.readPdf(signal);
    return { source, snapshot };
  } finally {
    await handle.close();
  }
}
```

句柄有 `document`、`readPdf`、`getPageFacts`、`getLayoutObservations`、`getSemanticPage`、`getDocumentSemantics`、`analyze` 和 `close`。返回的字节与结构都是副本，不允许通过它们改写权威事实或语义。

- `analyze({level: "facts"})` 确保所有页的原生事实，不要求版面语义完整；不能把这个快照当作完成的全文结构。
- 默认 `level: "layout"` 确保所有页的事实及版面分析，返回完整覆盖的语义；失败或取消会拒绝，不伪装为完整结果。
- `DocumentSnapshot` 包含 `document`、`level`、全部 `facts` 和当前 `semantics`。普通 `getDocumentSemantics()` 仍可能返回部分覆盖，检查 `coverage`。
- 进度为 facts/layout 两阶段，各自 `completed/total`；不是整个翻译任务的总百分比。
- 打开时的 signal 只控制打开过程；后续可取消操作传自己的 signal。**取消 analyze 会关闭该句柄并释放其分析资源**；继续任务时重新打开，已提交的分阶段缓存可复用。
- `close()` 可重复调用。插件停止会自动关闭未释放句柄，每次激活最多同时持有 8 个；不要依赖最终清理维持长时间占用。

句柄会话与阅读器会话分开持有，共享持久分析缓存。停止插件任务不取消本体阅读器分析。

## 保存二进制产物

```ts
const artifact = await context.artifacts.write(
  {
    id: "translated-pdf",
    name: "translated.pdf",
    mediaType: "application/pdf",
    sourceDocumentId: sourceId,
    bytes: generatedPdf,
  },
  signal,
);

const files = await context.artifacts.list(sourceId);
const bytes = await context.artifacts.read(artifact.id, signal);
await context.artifacts.export(artifact.id);
```

产物是用户数据，存于独立 IndexedDB `cachalot-extension-artifacts`，浏览器与桌面 Webview 使用同一适配契约。停用、重启、更新、卸载插件或清除论文缓存不删除产物；插件可用 `artifacts.delete(id)` 明确删除。当前没有本体的产物管理页，删除入口由插件提供。

ID 属于调用插件的命名空间，不能读取、覆盖、导出或删除其他插件的产物。相同 ID 的写入在一个事务中替换元数据与字节，保留 `createdAt`，更新 `updatedAt`（均为毫秒）；可用于 PDF 成品或检查点。`list` 只加载元数据，不复制大文件内容；`sourceDocumentId` 只是可选归属信息，不能推出原文与产物有语义对应。

ID 允许字母、数字、点、下划线、连字符，首位为字母或数字，最长 128；name 为不含路径和控制字符的文件名，最长 240；单份产物最多 256 MiB。读写可取消，提交成功才返回。export 通过本体发起浏览器/Webview 下载，不接收文件系统路径，不代表已经提供原生保存对话框。

## 两条 PDF 生成路线

`pdf.inspect(bytes, signal?)` 返回 1 起始的页码和显示页宽高（PDF 点）。`pdf.compose(input, signal?)` 接收来源 PDF 数组及目标页计划，返回独立新 PDF，不修改输入。计算在单独的 PDF Worker 中排队；取消会终止自己的计算 Worker，不重启本体或阅读器。

### 保留原页，清理文字并插入译文层

插件把目标文字排版为独立 PDF，然后提供清理范围与叠加层：

```ts
const output = await context.pdf.compose(
  {
    sources: [sourcePdf, translatedTextLayer],
    pages: [
      {
        source: { source: 0, page: 1 },
        removeText: paragraphSourceRefs,
        overlays: [{ source: 1, page: 1 }],
      },
    ],
  },
  signal,
);
```

目标页复制原页的资源与尺寸。removeText 使用对应 PageFacts 的 `SourceRef`，核验来源 SHA-256、page、factsKey 和 characterIndices；实际移除输出副本的原生文字对象，避免只盖住英文却仍可复制英文。

**当前仅支持完整顶层文字对象的移除。** 如果选中的字符只覆盖对象一部分、对象嵌套在 Form 中，或者来源已过期，会拒绝整个合成。不能忽略错误后用白色矩形冒充文字已删除。多个 SourceRef 的字符可合并覆盖一个完整对象；PDFium 生成的辅助字符不作为可删除对象。此功能不是任意复杂 PDF 的完整内容重写引擎。

### 从空白页组合目标排版与原生资源

```ts
const formula = await context.pdf.exportRegion(sourcePdf, 1, formulaBox, signal);
const output = await context.pdf.compose(
  {
    sources: [typesetPage, formula.bytes],
    pages: [
      {
        width: 595,
        height: 842,
        overlays: [
          { source: 0, page: 1 },
          { source: 1, page: 1, box: targetFormulaBox },
        ],
      },
    ],
  },
  signal,
);
```

省略 source 时创建空白页，width/height 是 PDF 点；提供 source 时不能同时指定尺寸。叠加层按数组顺序绘制，box 是目标显示页归一化区域，省略则铺满整页；插件应提供合适的宽高比，宿主按区域映射，不自行推断排版。

此路线可改变页数、段落位置及公式位置，文字排版 PDF 与裁出的图片、公式等来源资源由插件组合。PageFacts 仍是原文事实，不是完整字体、路径和绘制指令；插件建立自己的目标排版计划，不直接把事实里的英文字符串替换后假定所有资源已齐全。当前宿主不提供文字排版器，也不自动重建原文书签、链接或目录。

两条路线可在同一次合成中逐页混用。每次最多 256 个来源、来源总计 256 MiB、10,000 个目标页；单页尺寸最多 20,000 PDF 点。应按任务规模管理中间资源。

## 复杂行内公式无需 OCR 的迁移

`pdf.exportRegion(bytes, page, box, signal?)` 返回 `{bytes, width, height, contentIsolation: "visual-crop"}`。它复用原 PDF 的字体、路径和图像，使用可见裁切，不先栅格化；扫描 PDF 中原本的图片仍是图片。图形组合也可以直接作为资源迁移，不要求先理解数学结构。

推荐插件按以下过程处理行内公式：

1. 从文档语义及来源事实取得公式区域，核对相邻文字与基线。**裁切复用不代表现有公式检测必定完整或准确。**
2. 在清理输出原文之前，从完整来源裁出公式，并建立自己的公式资产 ID。翻译正文使用占位符，最终校验 ID、数量与归属。
3. 将公式视为不可拆分的行内排版单元，保存宽度、高度及相对基线位置。排版器为它留出槽位；放不下时整体换行，大于可用行宽时明确缩放或改为独立行。
4. 目标文字排版结束后，将原生公式 PDF 放入槽位。原公式不调用 OCR，也不交给正文模型重写。

基线不是裁框中心，复杂分式、积分与上下标需要可靠的来源基线证据。优先核对公式所在正文行的基线；分子、分母各自的字符基线不能直接代表整个公式。SemanticFormula.baseline 是推断证据且可能缺失，不能无条件使用。确认基线后，可把 `(baseline - sourceBox[1]) * sourcePageHeight` 作为裁图顶部到基线的 PDF 点距离，结合裁图高度得到基线以下距离；排版器据此留出行高，再将公式顶部放在目标基线减去该距离的位置。缩放时这两个距离同时缩放。

译文坐标重新计算，不能沿用原位置。原页复制路线还需处理公式与正文共用文字对象的情况：当前 removeText 不能拆对象；可以在完全覆盖且能完整恢复的条件下移除整个对象再恢复公式，否则拒绝并选择重建路线或进一步的对象级实现。

矩形裁切可能带入相邻文字，跨行/不规则区域可能需要多个资产，插件必须核对。**visual-crop 并没有删除区域外的隐藏内容或资源**，不得作为安全脱敏导出。compose 会保留可见裁切边界，移动裁图后区域外内容不会在页面上露出；这与底层内容隔离是两回事。

## 通用并列 PDF 阅读

```ts
const comparison = await context.reader.openPdfComparison({
  id: "my-publisher.my-plugin.comparison",
  documentId: sourceId,
  artifactId: artifact.id,
  title: "Translated PDF",
  alignment: translatedAlignment,
});

await comparison.reveal("derived", { page: 2, fraction: 0.3 });
await comparison.update({ synchronized: false });
// await comparison.close();
```

左侧为文献库原文，右侧为插件自己的 PDF 产物；每个来源同时有一份比较视图。右侧可以显示完全无关的 PDF。它只使用 PDF.js 渲染页面与文字层，支持独立缩放、滚动、文字选择和复制，**不启动 PageFacts、版面分析或文档语义，不提供框选翻译，也不继承左侧分析**。用户需要分析产物时，将它作为新文献导入。

打开比较不改变 `activeDocumentId`，本体问答和现有阅读交互仍对应左侧来源。切换/关闭原文不会关闭插件文档句柄；比较随对应原文工作区展示，插件停止或关闭比较会释放右侧视图，已保存产物保留。删除正在显示的产物会关闭其比较；替换产物不会自动热更新已打开的字节，应关闭后重新打开。

comparison ID 必须有本插件 ID 前缀；只能显示本插件产物，mediaType 必须为 application/pdf 且内容可解析。title 为插件提供的显示标题，可按当前语言生成。

### 对齐与联动

alignment 是插件显式提供的 `PdfAlignment[]`，每项有唯一 id、一个 original `{page, box}` 和一个或多个 derived `{page, box}`。适合原段落翻译后跨页的情况；两个端点各自使用显示页归一化坐标。宿主验证页码、区域、重复 ID；不会从两份 PDF 自动推断对应关系。

有显式非空 alignment 时默认联动，没有时默认不联动。插件或用户可明确打开/关闭联动；无对齐时显式联动使用页码与页内比例回退，超出页数时限于最后一页。对齐包含一对多时按区域高度分配阅读进度；没有精确命中时使用同页最近区域，再回退到页码。它用于阅读导航，不是字符对应或语义分析。

两侧按 `{page, fraction}` 的阅读线位置联动，适应不同缩放与分页，不直接复制 scrollTop。comparison.reveal 可分别定位两侧。界面可拖动或用键盘调整左右比例，原文阅读器不因打开/关闭比较而重建。

`reader.getViewStates()` 与 `onDidChangePaneState` 提供所有已挂载阅读区域的状态，增加 viewId、anchor 和 cause。`cause: "navigation"` 表示程序定位，`"user"` 表示用户阅读变化；自建同步逻辑应忽略导航回声。事件为 null 时重新获取当前集合确定关闭的视图；右侧 documentId 是产物展示身份，不能传给 documents.openDocument。旧 `reader.viewState/onDidChangeViewState` 继续只表示原文。

## 任务与恢复由插件组织

可以结合 `window.withProgress`、实时 `lm.getModels()` 和产物检查点完成后台任务。开始操作时重新查询已启用模型，显式传 providerId/modelId；不得缓存激活时目录或调用未启用模型。

停止插件会撤销文档句柄、比较视图和未完成服务调用；本体 PDF 阅读与聊天继续。持久检查点和成品保留，恢复翻译由插件定义并验证来源 hash、事实版本、目标设置与已完成单元。不保存凭据；小型索引用 globalState，PDF 等大字节用 artifacts。
