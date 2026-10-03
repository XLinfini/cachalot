# Cachalot

学术 PDF 阅读、选区翻译与论文问答应用。TypeScript 应用服务与 React 界面分层；PDF.js 显示原文，PDFium 提取字符/绘图对象，Docling Heron ONNX 识别版面。桌面端使用 Tauri 2、Rust 与 SQLite。问答界面接入 assistant-ui 的 ExternalStoreRuntime，历史会话保存在本地数据库。公式通过 KaTeX 排版。

## 运行

需要 Node.js、Rust 以及 [Tauri 2 的系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
npm install
npm run models:prepare
npm run tauri dev
```

仅预览界面时可运行 `npm run dev`。浏览器预览将 PDF、首页预览和问答图片放在 IndexedDB、元数据放在 localStorage；API Key 使用 Web Crypto 加密后持久保存在 IndexedDB，刷新和浏览器重启后可恢复。桌面应用将 PDF 和会话保存在应用数据目录，API Key 存入操作系统密钥库。

## 使用

界面支持简体中文和英语，可在「设置 → 通用设置 → 界面语言」切换；选择会保存在当前设备。

「设置 → 缓存管理」展示 5 类缓存的内容大小、记录数和总量：PDF 原生提取、版面分析、问答文字索引、首页预览、公式裁图与 OCR。可分别清除，包括旧版本；不会删除论文、聊天、设置和密钥。公式缓存清除后可能需要重新请求远端识别。大小是内容字节数估算，不等于数据库文件的物理大小；存储位置与恢复行为见 [缓存管理说明](docs/architecture.md#缓存管理)。

1. 导入 PDF，页面像 Word 一样连续纵向排列，鼠标滚轮可直接浏览上下页；缩略图、目录和翻页按钮可跳转，可恢复上次阅读页码。
   文献库卡片显示论文第一页，并保存预览缓存。
   首次打开会逐页分析版面，成功页保存到缓存；中断后再次打开会继续缺失页。“版面”按钮可显示识别区域，供核对图、表、正文和公式。
2. 到「设置 → 模型服务」添加 OpenAI 兼容接口。填写 API 根地址；可获取模型列表，也可手填模型 ID。「模型支持图像理解」仅作用于当前填写的模型 ID。
3. 在阅读器中框选区域并点击「翻译选区」。也可切换到文字模式直接选择文字。翻译提示词在「设置 → 阅读与翻译」编辑。
   公式随页面定位并保存，简单上下标和希腊字母生成 LaTeX 阅读候选；复杂公式由单独选择的远端 OCR 或图像模型按需识别并缓存。原文与译文按位置标记渲染同一份通过检查的 LaTeX；失败或不完整的公式保留原图，翻译模型不改写公式。公式标记缺失、重复或顺序变化时会提示重试。只选中公式一部分时保留该部分，不自动补全。
4. 在右侧问答栏提问。应用从 PDF 文本中检索相关页面，连同会话上下文发送给所选模型；支持历史会话、编辑、复制、重新生成和删除。
   发送键左侧的模型菜单向上展开，先展开提供商，再选择模型。左下角「+」可上传图片；文字模型下禁用并显示提示。图片随会话保存，切换到文字模型后请求自动省略历史图片，切回图像模型可再次使用原图。若草稿含图片，切到文字模型会保留草稿并阻止发送，需移除图片或切回图像模型。

## 配置远端公式 OCR（优先 GLM-OCR）

1. 在「设置 → 公式 OCR」点击「添加 GLM-OCR 预设」，填写自己的智谱 API Key 并保存。默认地址为 `https://open.bigmodel.cn/api/paas/v4`，模型 ID 为 `glm-ocr`，接口类型为「GLM 专用版面接口」。Z.AI 用户可改为 `https://api.z.ai/api/paas/v4`。密钥应与对应平台的 API 地址配套。
2. 在「设置 → 公式 OCR」选择「使用独立的 OCR 模型」，展开服务商并选择已添加的 `glm-ocr`。选择自动保存。翻译/问答模型仍在聊天框选择，可使用文字模型。
3. 框选后先识别复杂公式，再翻译。中间原文栏和右侧译文栏使用同一份通过检查的 LaTeX；识别失败或只框选了一部分公式时保留原图。

每个已添加模型可配置 OCR 接口类型：GLM 版面 API、专用公式 OCR 的 Chat 兼容接口（固定任务 `Formula Recognition:`，适用于兼容的远端 GLM/PaddleOCR 部署），或多模态 LLM 字符证据方案。前两类专用 OCR 模型不会出现在聊天模型菜单中。GLM 官方版面 API 的模型列表使用固定预设，不请求 `/models`。其他未支持的私有协议需增加适配器，不能只改模型 ID。

厂商支持集中在 `src/infrastructure/ocr/providers/`，通过 `OcrAdapter` 统一调用并自动注册。常规 JSON / Chat API 新增一个 TypeScript 文件即可扩展接口、模型预设和中英文设置选项，无需修改应用流程或 Rust 厂商逻辑。详见 [OCR 适配器开发指南](src/infrastructure/ocr/providers/README.md)。

「检查连接」对专用 OCR 发送一张本地生成的测试公式，可能产生服务商费用。浏览器预览还受提供商 CORS 限制；Tauri 桌面请求由 Rust 发起。真实密钥复用原有存储（桌面 keyring / 浏览器 IndexedDB），没有额外 OCR 密钥副本。自动化验证使用本地响应夹具，未调用用户的真实服务商。

协议依据：[GLM-OCR 官方 SDK](https://github.com/zai-org/GLM-OCR)、[Z.AI 版面 API](https://docs.z.ai/api-reference/tools/layout-parsing)。

## 当前范围

- 文本可提取的 PDF 可以建立页面索引。尚无扫描件全文 OCR；复杂公式可调用独立的远端 OCR 或用户所选图像模型转写。原始公式是显示与后续导出的依据，LaTeX 候选尚未经语义验证。
- 桌面与浏览器使用同一固定版 Heron FP32 权重（约 171 MB），运行时本地推理，无需 API Key。翻译和问答仍需配置模型服务。iPad 尚待真机验证。
- 问答使用本地页面文字的轻量检索，并提示模型标明页码；引用页码仍需人工核对。
- 翻译和问答使用兼容 `/chat/completions` 的流式接口；服务商可提供 `/models`，也可手工填写模型 ID。GLM-OCR 使用专门的版面接口。
- 桌面端为主要运行环境。浏览器预览可能受到模型服务商的 CORS 限制。

## 验证

```bash
npm run build
npm run test:all
cd src-tauri && cargo check
npx tauri build --debug --no-bundle
```

分层接口、模型输入输出、缓存版本和界面重构约定见 [开发交接文档](docs/architecture.md)。Tailwind 主题与通用控件见 [样式维护指南](docs/styles.md)。测试分层、真实论文回归和夹具规范统一见 [测试维护指南](tests/README.md)。

界面文案、语言偏好、消息代码和多语言验证见 [i18n 维护指南](docs/i18n.md)。
