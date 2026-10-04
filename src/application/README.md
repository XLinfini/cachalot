# 应用层目录与依赖

按处理环节放文件。目录说明所属环节，文件名说明具体职责；同样处理公式的文件可能属于不同环节。

```text
document-analysis/             文档分析：事实、页面和全文语义
  session.ts                   生命周期、Worker 调度、分阶段缓存
  page-semantics.ts             页内归属、去重、阅读顺序
  document-semantics.ts         全文结构、章节关系、页面投影
  formulas.ts                  公式定位、原生简单结构恢复
ocr/                           按需识别：指定公式区域 → 候选与原图
  reconstruct-formulas.ts      裁图调度、批次、校验、候选缓存、失败回退
  validate-latex.ts            KaTeX 语法与原生字符保留检查
  settings.ts                  独立 OCR 选择与连接检查
  catalog.ts                   设置选项、预设和端点预览
selection-translation/         框选翻译：覆盖范围 → 模型请求 → 译文
  select-region.ts             精确字符/公式覆盖、部分裁剪、来源绑定
  context.ts                   同一文档语义快照中的有限背景
  translate-region.ts          OCR 与正文翻译的编排、流式阶段回调
  formula-slots.ts             公式位置标记、候选说明、校验与复制
  headings.ts                  标题协议、层级恢复与预览
  prompt.ts                    默认正文翻译指令
services.ts                    界面使用的副作用服务入口
paper-assistant.ts             论文问答检索和会话请求
model-catalog.ts                共用服务商、已添加模型及图像能力
import-paper.ts                文献导入
cache-management.ts            缓存统计与分类清除
```

各子目录有受控的 `index.ts` 公开入口。公开业务流程和界面所需的纯助手可以导出；内部构建器、校验器和请求协议不要全部导出。单元测试可直接导入内部被测文件。调整目录时同时更新消费者、测试及 [架构文档](../../docs/architecture.md)，不留下旧路径的转发文件。

## 调用与数据边界

1. **文档分析**通过基础设施取得 `PageFacts`/`LayoutObservations`，生成 `DocumentSemantics` 及临时 `SemanticPageView`。公式区域和字符证据来自这里；简单原生 LaTeX 在投影时恢复，远端候选不写入事实或语义。此目录不导入 OCR 或框选翻译。
2. **框选翻译**读取该投影，确定实际命中的字符及公式。未命中的内容不能因上下文或重建而扩入正文；部分公式撤销 LaTeX、保留裁剪来源，不重建完整公式。
3. **OCR**接收 `FormulaReconstructionRequest` 的公式列表，通过 infrastructure 裁图、识别和保存候选。返回 `FormulaReconstructionResult` 的资产与问题；候选通过语法/字符检查仍不代表数学正确。此目录不接收整份选区、不产生翻译位置标记、不导入框选翻译。
4. **框选翻译**消费这些候选或原图，生成正文、背景、公式说明及标题协议，调用翻译模型并校验返回位置。候选可更新中栏预览，之后翻译失败也能继续核对。

跨层使用领域 DTO 和公开入口。`createFormulaReconstructor(ports)` 暴露小范围副作用端口，默认实现连接 infrastructure；测试替换裁图、识别、设置和候选仓库，不替换业务校验。厂商请求字段、URL、响应解析和凭据传输仍放在 `infrastructure/ocr/`；PDF 渲染、PNG/矢量裁剪仍放在 `infrastructure/pdf/`。domain/infrastructure 不反向导入 application。

把文件放入 application 的判断依据是它是否决定应用行为、范围和流程；SDK、Worker、网络、持久化或图像渲染的具体实现放入 infrastructure。一个文件同时含两类职责时，拆出接口及适配器。不要仅按文件名前缀或所用技术分组。

## 测试与缓存兼容

依赖方向、纯规则、服务编排和真实界面流程分开验证，位置与运行方式见 [测试维护指南](../../tests/README.md)。纯目录调整不改变缓存版本；字符提取、语义或识别规则实质变化时，只更新对应版本与回归。
