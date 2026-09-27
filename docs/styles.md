# 界面样式维护

界面使用 Tailwind CSS 4，由 `@tailwindcss/vite` 在构建时生成样式。组件使用 TypeScript；样式变更通常只涉及下列文件。

| 位置 | 修改内容 |
| --- | --- |
| `src/styles/app.css` 的 `@theme` | 全局字体、主题色、圆角、阴影、断点 |
| `src/components/ui/styles.ts` | 按钮、输入框、导航等通用控件的样式组合 |
| `src/App.tsx`、`src/components/*.tsx` | 页面布局、间距、组件特有的样式和交互状态 |

例如，修改 `--color-brand` 会更新所有 `bg-brand`、`text-brand`、`border-brand` 的使用位置；修改 `ui.primaryButton` 会更新共用该样式的主要按钮。旧版色值与尺寸保留在组件中，重设计时可逐步收敛为主题变量。

## 编写约定

- 类名必须是完整的字面量。不要拼接 `bg-${color}`；参考 `pdf/PdfPageView.tsx` 的 `BLOCK_COLORS`，用静态映射选择完整样式。
- 按钮状态使用 `aria-pressed:*`，选中项可使用 `data-[active=true]:*`；悬停和键盘焦点使用 `group-hover:*`、`group-focus-within:*`，表单联动使用 `peer-*`。
- `cx()` 只连接类名，不处理冲突。同一个元素的同一种属性应明确选择一个值；类名在字符串中的先后顺序不决定覆盖关系。
- 运行时坐标继续使用 `style`：PDF 缩放尺寸、框选矩形、版面区域、截图位置和目录层级缩进。不要把这些数值生成动态 Tailwind 类名。
- `data-ui` 是浏览器测试的稳定定位标记。调整布局和类名时保留标记，测试不依赖某个颜色或样式类。
- 业务服务仍在 `src/application/`，持久化与模型调用仍由适配器提供。界面重构继续通过这些接口接入，详见 [开发交接文档](architecture.md)。

当前断点为 `compact: 940px`、`desktop: 1200px`，沿用桌面和 iPad 横屏的布局。没有增加竖屏专用布局。

文献库卡片的第一页图片由 `DocumentPreview.tsx` 展示，保留 `data-ui="document-preview"`。问答输入框由 `ChatComposer.tsx` 管理，底部从左至右为图片上传、模型选择和发送。`ModelPicker.tsx` 的菜单通过 `bottom-full` 向上展开；提供商只负责展开模型列表，模型按钮才改变选择。调整样式时保留 `chat-composer`、`upload-image`、`draft-image`、`model-picker`、`model-picker-trigger`、`model-menu` 和 `message-image` 标记。较长模型 ID 需在按钮内截断，避免挤出发送键；菜单及禁用上传提示不要被输入框容器裁剪。

## PDF 和公式样式

`src/styles/pdf-text-layer.css` 是 PDF.js 自动生成的文字层所需的兼容样式。这里的绝对定位、字体变换和选择规则用于对齐 PDF 字形，单独保留并标注了原因。文字层的指针事件由阅读器的 Tailwind 类控制。

连续阅读的滚动容器为 `data-ui="pdf-scroll"`，各页为 `data-ui="pdf-page" data-page="页码"`。页栈的 `gap-6` / `py-7` 分别对应 `pdf/page-layout.ts` 的 `PAGE_GAP=24` / `PAGE_PADDING=28`；修改页面间距时同步这两处，避免导航和缩放定位偏移。每页宽高由 PDF 实际尺寸与缩放计算，不要用固定 CSS 尺寸覆盖。

KaTeX 使用其自带样式；`MathMarkdown.tsx` 用 Tailwind 的后代选择器调整段落、列表、代码和公式容器。页面主题重构时需检查文字选择、公式溢出和选区截图。

翻译结果中的 `data-ui="preserved-formula"` 使用无损 PNG 来源，行内公式的 `width` 与 `verticalAlign` 根据原有效字号和基线计算。不要将来源公式替换成 OCR LaTeX 的 KaTeX 输出，也不要用固定高度拉伸公式。行间公式限制最大宽度、保持比例，后续 PDF 导出使用独立的矢量裁剪服务。

翻译弹窗采用横屏三栏（PDF 选区图片 / 重建原文 / 译文），最大宽度 1440px，各栏独立滚动。`data-ui="translation-reconstructed-source"` 是核对公式的中栏，允许以 `latex-candidate` 渲染，原始截图始终可在左侧比较。其右上角 `translation-source-format` 按钮切换排版预览与 LaTeX 源文本；无需另设折叠原文预览。未能重建的公式仍显示来源图片和原因。`npm run test:formula-transcription-ui -- /absolute/path/reference.pdf` 使用隔离浏览器与模拟接口验证两种语言下的三栏、字符辅助请求、分阶段更新、缓存和错误回退，不衡量实际 LLM 准确率。

重建原文与译文的标题来自选区块结构，而不是依靠模型自己选择 Markdown 层级。`MathMarkdown` 为 h1–h6 统一设置粗体、行距和上下间距，并逐级缩小字号。后续更换 UI 时，应保持这些 HTML 标题的语义，不将标题统一改为普通段落。浏览器验证还覆盖示例论文重叠检测的主标题、章节/字母小节、部分选中的标题，以及模型漏掉标题边界时的提示。

## 格式化与验证

```bash
npm run format
npm run format:check
npm run build
```

Prettier 配置了 Tailwind 插件，自动排序 TSX 的类名和 `cx()` 中的字面量。格式化脚本覆盖界面文件、样式、i18n 词典、React 入口和 Vite 配置。

浏览器样式检查使用独立浏览器上下文和模拟模型接口，不读取用户的 API Key，也不改变正在使用的文献库。首次需要准备论文解析结果和 Playwright Chromium：

```bash
npm run test:paper -- /absolute/path/reference.pdf
npx playwright install chromium
# 先在另一个终端运行 npm run dev
npm run test:styles -- /absolute/path/reference.pdf
```

已有 Chromium 时可设置 `CACHALOT_CHROMIUM`；测试生产预览时可设置 `CACHALOT_URL=http://127.0.0.1:1421/`。

脚本在 1440×1000 和 1194×834 两个尺寸下，分别使用中文和英语检查文献库、阅读器、翻译弹窗、模型服务、模型选择、翻译提示词和界面语言设置，也检查 PDF 文字拖选、框选翻译、服务商开关的键盘操作，以及语言恢复和草稿保留。`verify-model-composer.ts` 检查菜单向上展开、实际请求的提供商与模型、上传提示、图片持久化、发图后切换文字模型继续问答、切回图像模型，以及不兼容草稿的按钮/回车保护。`verify-formulas.ts` 在两种语言的桌面视口检查公式原图重排、LaTeX 请求、按需识别、缓存复用、切回文字模型和标记丢失保护，模型接口为模拟响应。连续阅读检查覆盖原生滚轮、上下页同时可见、页码同步、缩放位置、远页画布释放、第 2 页框选、跨页文字提示、50% 缩放下的末页导航和阅读页码恢复。生成 56 张截图，中文位于 `test-results/styles-after/`，英文位于 `test-results/styles-en/`。参考论文的解析结果来自 `test-results/paper-analysis.json`，解析质量由单独的解析测试验证。

2026-09-26：连续阅读、多语言、问答图片模型切换和公式原图重排的生产构建检查通过，生成 56 张截图，无未捕获的浏览器错误。这些桌面浏览器检查不能代替 iPad 真机验证。

Tailwind 参考：[Vite 接入](https://tailwindcss.com/docs/installation/using-vite)、[主题变量](https://tailwindcss.com/docs/theme)、[类名扫描规则](https://tailwindcss.com/docs/detecting-classes-in-source-files)。
