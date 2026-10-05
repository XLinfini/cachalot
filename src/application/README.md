# 本体应用层目录与依赖

[文档目录](../../docs/README.md) · 相关：[开发与贡献](../../docs/development.md)、[数据契约](../../docs/document-analysis.md)

本体负责阅读、文档理解、OCR、模型配置、文献库和问答，选区翻译已迁到 `src/extensions/selection-translation/`。不要把插件业务重新放回 services 或阅读器组件。

```text
document-analysis/             事实、原始版面观测、页内及全文语义
  session.ts                   生命周期、Worker 调度、分阶段缓存
  page-semantics.ts             页内归属、去重、阅读顺序
  document-semantics.ts         全文结构、章节关系、页面投影
  formulas.ts                  公式定位、原生简单结构恢复
ocr/                           明确公式区域 → 原图、识别候选与问题
  reconstruct-formulas.ts      裁图、批次、取消、校验、候选缓存
  validate-latex.ts            KaTeX 语法与原生字符保留检查
  settings.ts / catalog.ts     OCR 模型选择、预设和端点
extensions/                    公开 SDK 与本体能力之间的宿主
  host.ts                      安装元数据、激活作用域、注册、事件与状态
  dependencies.ts              依赖图校验、消费者释放顺序
  installer.ts                 本地包安装计划、持久化与运行目录更新
  events.ts                    Disposable、事件与取消适配
  runtime.ts                   唯一内置插件组合入口与本体服务适配
services.ts                    本体界面的副作用服务入口，不向插件公开
paper-assistant.ts             本体问答检索和会话请求
model-catalog.ts               已添加模型和图像能力
import-paper.ts                文献导入
cache-management.ts            缓存统计与分类清除
```

插件只依赖公开 `src/sdk/index.ts` 与可选 `src/sdk/react.tsx`，不得导入 application、infrastructure、components 或其他插件。核心代码不得导入插件实现，`extensions/runtime.ts` 组合入口除外。domain/infrastructure 不反向导入 application。结构规则由 `tests/unit/application-boundaries.test.ts` 检查。

文档分析输出 PageFacts、LayoutObservations、DocumentSemantics 与临时 SemanticPageView，不调用 OCR/LLM。OCR 接收具体 FormulaFragment，不决定选取范围、翻译上下文或位置协议。插件消费这些能力，确定正文范围并使用 SDK 调用模型。`ReaderSelection` 只描述页面来源和临时预览，翻译 DTO、提示词、标题/公式协议和结果格式属于插件。

跨层使用领域 DTO、公开 API 和窄副作用端口。`createFormulaReconstructor(ports)` 供隔离测试连接裁图、识别、设置与候选仓库；生产逻辑与校验不替换。凭据、Tauri 命令名和网络适配器只存在于本体。SDK 配置、状态和事件均有插件作用域。

目录调整同时维护 [架构文档](../../docs/architecture.md)、[插件开发指南](../../docs/extensions.md) 和 [测试约定](../../tests/README.md)，不保留旧路径转发。纯移动不改变缓存版本，提取、语义或识别规则变化时再更新相应版本。

本地安装包通过 infrastructure/extensions 的 ZIP 校验、独立仓库和沙箱 Worker 接入；外部代码不使用内置模块的可信 load。依赖插件只能通过 SDK extensions.getExtension 访问公开 API。安装与重启只换插件作用域，不能重启本体、卸载文档分析会话或取消本体问答。
