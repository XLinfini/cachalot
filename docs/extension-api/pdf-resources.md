# 原生绘制事实与资源

[插件开发](../extensions.md) · 相关：[数据契约](../document-analysis.md)、[PDF 合成](pdf-artifacts-and-comparison.md)

API **0.1.4** 增强 PageFacts，并提供可解析的资源引用。清单使用 `"engines": { "cachalot": "^0.1.4" }`，读取需要 `documents.read`。这些能力由本体提供，选区翻译、全文 PDF 翻译、图形提取等插件共用。

## 页面事实包含什么

`PageFacts.schemaVersion` 为 **2**，`cacheKey` 绑定 PDFium、绘制提取和资源定位版本。原有 `characters`、`objects` 及显示坐标保留；新增 `graphics` 表示物理绘制信息。段落、标题、公式归属仍由 DocumentSemantics 解释，译文及目标布局不能写回来源事实。

| 字段                                        | 含义                                                               |
| ------------------------------------------- | ------------------------------------------------------------------ |
| `graphics.mediaBox / cropBox / rotation`    | 原生页面框与固有旋转                                               |
| `graphics.objects`                          | 按绘制顺序排列的对象树，Form 的 `children` 递归展开                |
| `path`                                      | 对象在各层的零基序号，例如 `[3, 1, 0]`                             |
| `matrix / pageMatrix`                       | PDFium 对象矩阵与包含祖先 Form 的矩阵                              |
| `bounds / box`                              | 原生包含空间的包围框与显示页归一化包围框                           |
| `fill / stroke / strokeWidth / dash / clip` | 可读取的颜色、线宽、虚线及裁剪路径；颜色通道为 0–255               |
| `shape`                                     | 路径段、填充规则与描边开关；三个连续 bezier 点表示三次曲线         |
| `text`                                      | 原生文字、字符索引、字体大小、渲染模式与字体属性/资源引用          |
| `image`                                     | 像素尺寸、位深、PDFium 色彩空间编号、过滤器与图片流引用            |
| `resource / pageResource`                   | 对象或整页的原生 PDF 引用                                          |
| 字符的 `objectPath / pdfOrigin / matrix`    | 关联绘制对象、原生基线原点与字符矩阵；自动生成的分隔符没有对象归属 |

原有 `objects[].id` 仍表示**顶层**对象序号，供现有 SourceRef 使用；嵌套对象用路径区分，不能把路径最后一位当顶层 ID。字符 index 来自 PDFium，可能有空隙；文字对象的 characterIndices 对应此索引，包含原生可索引字符，不代表可靠的阅读顺序或数学结构。

坐标必须区分：显示 `box` 使用 `[left, top, right, bottom]`，归一化且包含页面旋转；原生 `bounds`、mediaBox、cropBox 使用 PDF 点和 `[left, bottom, right, top]`。路径点与矩阵保持 PDFium 的用户空间；`pageMatrix` 把对象局部坐标映射到页坐标。bounds 已含对象自身矩阵，只需祖先矩阵才能映射到页，不能再次乘自身矩阵。clip 是 PDFium 返回的包含空间路径，不是归一化显示框。`PdfMatrix=[a,b,c,d,e,f]` 满足 `x'=ax+cy+e, y'=bx+dy+f`。

`preservation: "native-page"` 表示整页具有原生资源；`geometry-only` 仅用于合成几何夹具，不支持原生重建。`truncated` 标识暴露的结构是否触及对象/深度/路径或 8 MiB 序列化上限，具体情况在 `limitations` 中说明。结构截断时原生整页资源仍可读取。这个标记不意味着已经解码全部 PDF 语法。

## 读取资源

资源引用只包含 `documentId`（来源 SHA-256）、`factsKey`、`page`、`kind` 和可选 `objectPath`。不包含进程指针、宿主路径或图片/字体大字节。

```ts
const handle = await context.documents.openDocument(sourceId, signal);
try {
  const facts = await handle.getPageFacts(1);
  const ref = facts.graphics.pageResource;
  if (!ref) throw new Error("Native page resource unavailable");
  const resource = await handle.readResource(ref, signal);
  // Also available when you already hold the exact source bytes:
  const same = await context.pdf.resolveResource(await handle.readPdf(signal), ref, signal);
  console.debug(resource.kind, resource.bytes.byteLength, same.kind);
} finally {
  await handle.close();
}
```

| kind           | 返回内容                                             | 使用注意                                                                                        |
| -------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `page-pdf`     | 单页自包含 PDF、显示宽高，`contentIsolation: "page"` | 通过 compose 导入该资源的第 1 页，保持原页框与旋转                                              |
| `object-pdf`   | 原页尺寸的 PDF，保留相关原生绘制资源                 | 顶层对象返回 `object-drawing`；嵌套对象返回 `form-group` 并保留整个外层 Form                    |
| `font-program` | PDFium 字体程序字节、name、embedded                  | 非嵌入字体可能返回 PDFium 替代字体；`embedded: false` 不能当成原 PDF 内嵌字体                   |
| `image-stream` | 原始流字节、尺寸、位深、色彩空间、filters            | 不是保证可直接加载的 PNG/JPEG；可能需要 PDF 过滤器、调色板或软蒙版，保真迁移优先读取 object-pdf |

对象 PDF 的 `preservedObjectPath` 明确实际保留的来源对象，当前是顶层路径。嵌套导出保留 Form 的矩阵、裁剪及绘制状态，不宣称叶对象完全隔离。原因是当前 PDFium 重写部分带 `/Matrix` 的 Form 内容时会重复变换；直接删除其子对象再生成会改变字形位置。插件必须检查 `contentIsolation`，不能把 form-group 当作只包含某个公式的资产。需要局部可见范围时对返回 PDF 再用 `exportRegion`，并明确它仍是视觉裁切、可能含重叠内容。导出后的对象坐标/序号属于新 PDF，不继续套用原来源路径。

资源引用在 JSON 中保存后，可在**同一原始 PDF、同一 factsKey** 的新句柄中解析。读取会校验真实字节哈希、版本、页码、每层对象路径和资源类型；不存在、过期、类型不符或无法提取的资源会拒绝，不猜测替代对象。句柄只接受自己的文档；`pdf.resolveResource` 解析调用方已有的字节，不读取任意文件。旧句柄关闭后不能继续使用，插件停止会关闭句柄并取消计算。单次 resource read 的取消保留句柄可用，与取消 analyze 后关闭句柄的行为不同。

返回结构和字节都是副本。解析计算在独立 PDF Worker 中排队，取消只终止相关计算，不重启本体或阅读器。输入 PDF 上限 256 MiB；单个字体/图片流上限 128 MiB，PDF 资源上限 256 MiB。字体/图片流可能不存在，例如缺损或无可读取程序的字体，此时拒绝；原生 PDF 资源是保真使用的主要入口。

引用依赖来源仍可用，不是已经落盘的资产。需要在来源删除、解析版本变化后继续使用时，把解析出的自包含 PDF 保存到自己的 artifacts；引用与读取结果可按 documentId/factsKey 缓存，不跨版本复用。对象导出移除其他可见绘制，仍可能保留未使用的资源字节，不能用作脱敏或安全删除。

## 从事实和资源重建页面

```ts
const sources: Uint8Array[] = [];
const pages: { source: { source: number; page: number } }[] = [];
const snapshot = await handle.analyze({ level: "facts", signal });
for (const facts of snapshot.facts) {
  const ref = facts.graphics.pageResource;
  if (!ref) throw new Error("Native source page unavailable");
  const resource = await handle.readResource(ref, signal);
  pages.push({ source: { source: sources.length, page: 1 } });
  sources.push(resource.bytes);
}
const rebuilt = await context.pdf.compose({ sources, pages }, signal);
```

此例需要 read 和 write，受 compose 的来源数量/总字节限制；大文档应分批处理，直接保留整份来源可避免重复导出。原生资源保留 PDFium 公共 getter 没有展开的内容流、字体编码、图片关联资源和图形状态，完成“事实 + 可解析资源 → 原生页面”的路径；不保证输出文件与输入字节相同，也不自动重建整份文档的书签、链接关系或目录。

独立排版则从 DocumentSemantics 选择翻译内容，读取需要保留的原生资产，生成新的目标字体、坐标和排版 PDF，再 compose 到空白页面。**当前没有把修改后的 graphics JSON 直接编码成 PDF 的通用绘制指令写入器。**原始字符编码、blend mode、完整资源字典等仍由原生资源保留，不能把 PageFacts 的 text 替换为中文便直接提交为输出。译文和目标排版另存，后续可以在现有来源层上建设目标绘制表示与编码器。

这版不新增 OCR、数学识别或 LaTeX 排版器，也不改变右侧产物 PDF 的被动阅读约定。
