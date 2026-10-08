# XeLaTeX 排版服务

[插件开发](../extensions.md) · [PDF 产物与比较阅读](pdf-artifacts-and-comparison.md) · [用户设置](../user-guide/typesetting.md)

API **0.1.5** 提供 `context.typesetting`，清单声明 `"engines": { "cachalot": "^0.1.5" }` 和 `"capabilities": ["typesetting"]`。可信内置模块与安装后的 Worker 使用相同接口。该能力授予本地 LaTeX 编译，不授予本机路径、可执行文件选择、宏包安装或原生命令调用。

当前实现支持 **Linux x86-64 桌面版**；浏览器返回 `desktop-only`，其他平台返回 `unsupported-platform`，编译拒绝。不能把浏览器预览或安装包构建成功当作 Windows/macOS 支持。运行时使用固定 TeX Live 2025 final，XeLaTeX 生成 XDV，本体单独调用 xdvipdfmx 生成 PDF；每个任务都有独立工作目录和进程。

## 检查与编译

```ts
const status = await context.typesetting.getStatus();
if (!status.available) {
  context.window.showErrorMessage(`XeLaTeX unavailable: ${status.reason}`);
  return;
}
const result = await context.typesetting.compile({
  source: String.raw`\documentclass[fontset=fandol]{ctexart}
\usepackage[paperwidth=100mm,paperheight=40mm,margin=5mm]{geometry}
\pagestyle{empty}
\begin{document}
中文译文与数学公式 $E=mc^2$。
\end{document}`,
  passes: 1,
}, context.signal);
if (!result.success || !result.pdf) {
  context.window.showErrorMessage(result.log);
  return;
}
await context.artifacts.write({
  id: "translated-paragraph", name: "paragraph.pdf",
  mediaType: "application/pdf", bytes: result.pdf,
});
```

最后的保存需要 `documents.write`；使用 `pdf.compose` 还需要 `documents.read`。编译本身不写插件产物、不调用 LLM、不翻译文本，也不改动 PageFacts 或 DocumentSemantics。首次编译会自动初始化本体随附的运行时，无需下载编译器或重启软件。

| 输入 | 约束 |
| --- | --- |
| source | 完整 UTF-8 LaTeX 文档，非空，最多 2 MiB；任务名固定为 document |
| assets | 可选 `{name, bytes: Uint8Array}[]`；最多 256 个，源码和附件合计最多 64 MiB |
| passes | 1、2 或 3，默认 1；需要交叉引用时由插件选择多轮 |
| timeoutMs | 1000–300000，默认 120000；整个 XeLaTeX + xdvipdfmx 阶段共用期限 |
| returnFiles | 可选产出的文件名数组，最多 64 个；适合返回尺寸、基线或版面测量表 |

附件和返回文件名是平面相对名称，首位字母或数字，最多 128 字符，只允许字母、数字、点、下划线、连字符；禁止 `..`、路径、重复项和 `document.*` 保留名称。返回文件不能与附件重名。使用 `formula-1.pdf`、`figure.png`、`font.otf`、`slots.csv` 等名称。

返回 `{success, pdf: Uint8Array | null, log, files: {name, bytes}[]}`。TeX/驱动错误和超时返回 `success:false` 及日志；配置、输入、读取或取消错误会拒绝 Promise。缺失返回文件不出现在 files 中，插件应检查其必要测量表。输出 PDF 和测量文件合计最多 64 MiB，日志最多 1 MiB；单个中间文件与进程地址空间也有上限。

## 不经过 OCR 的行内公式

先用 `pdf.exportRegion` 或可解析的原生对象资源获得公式 PDF，把它作为附件参与 XeLaTeX 排版。公式进入 TeX 盒子后，宽、高与深度直接参与断行，而不是排完正文后再寻找空位：

```ts
const formula = await context.pdf.exportRegion(sourcePdf, page, formulaBox, signal);
const result = await context.typesetting.compile({
  assets: [{ name: "formula-1.pdf", bytes: formula.bytes }],
  source: String.raw`\documentclass[fontset=fandol]{ctexart}
\usepackage{graphicx}
\newsavebox{\fboxone}
\newwrite\measurements
\begin{document}
\sbox{\fboxone}{\includegraphics[width=22bp]{formula-1.pdf}}
\immediate\openout\measurements=slots.csv
\immediate\write\measurements{formula-1,\the\wd\fboxone,\the\ht\fboxone,\the\dp\fboxone}
\immediate\closeout\measurements
译文中的公式\raisebox{-5bp}{\usebox{\fboxone}}继续参与本行排版。
\end{document}`,
  returnFiles: ["slots.csv"],
}, signal);
```

示例中的尺寸和 raisebox 是示例值，真实插件根据公式区域、有效字号和基线决定宽度与下降量。基线调整后的最终盒子也可以再测量。测量输出的 TeX `pt` 为 1/72.27 英寸，PDF `bp` 为 1/72 英寸，换算到 PDF 点时乘以 `72 / 72.27`。排版结果可以直接作为 pdf.compose 的叠加页，不需要 OCR 成 LaTeX，也无需再次逐公式贴回。

`exportRegion` 是可见裁切，隐藏的来源资源可能仍保留；需要核对原生对象导出的 contentIsolation，不能把裁切当脱敏。来源区域完整性、占位符校验、字符转义、目标尺寸、溢出处理、字体选择与阅读对齐由插件决定。宿主不会把用户译文字符串自动当成安全的 LaTeX 正文；插入模板前应转义 LaTeX 特殊字符。

## 宏包、字体、模板与取消

内置 ctex/xeCJK、fontspec、unicode-math、amsmath/amsfonts、geometry、graphics、tools、xcolor，以及 Fandol、Latin Modern、TeX Gyre 字体与依赖。中文模板显式使用 `fontset=fandol`；附件字体可用 fontspec 的文件名加载，不依赖用户机器上碰巧存在的字体。

本体设置里的用户宏包树与模板目录独立于版本化运行时。用户宏包通过标准 `\usepackage` 搜索，模板可用 `\input{template-name}` 读取。这些目录在沙箱中只读；插件不能列出本机目录或调用 tlmgr。缺包时展示编译日志并引导用户到 PDF 排版设置安装，禁止插件私自下载或默默改变用户 TeX 环境。

编译在 Linux bubblewrap 隔离内进行：运行时、用户宏包/模板和系统运行库只读，任务目录可写；用户文献、数据库、凭据目录不挂载，网络隔离，shell escape 禁用。引擎和驱动都在该边界内。需系统支持用户命名空间；无法建立隔离时失败并返回日志，不降级到无隔离执行。

调用 signal、停止或重启插件会取消其任务并终止进程组。一个活动编译/宏包安装占用运行时队列，其余排队；排队等待可取消。初始化解压在阻塞工作线程运行，取消后尽快清理暂存目录，锁保留到工作线程退出，避免半成品被另一个任务读取。正常完成、失败或取消会清理任务目录；应用被强制结束时可能留下临时目录。取消编译不重启本体、不清除 PDF 视图或聊天。
