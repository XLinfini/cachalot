# 公式 OCR 适配器

[文档目录](../../../../docs/README.md) · 相关：[用户 OCR 设置](../../../../docs/user-guide/models-and-ocr.md)、[架构](../../../../docs/architecture.md)

每个文件默认导出一个 `OcrAdapter`。Vite 的 `register-providers.ts` 自动加载此目录的 `*.ts`；新增常规 JSON / OpenAI Chat 接口只需新增一个适配器文件，不必改注册表、设置组件、模型类型联合或 Rust 厂商分支。这是构建时扩展点，新增文件后需要重新构建应用，不是运行时下载插件。

现有实现：

| 文件              | 持久化 ID      | 接口                             |
| ----------------- | -------------- | -------------------------------- |
| `glm.ts`          | `glm-layout`   | GLM 官方版面 JSON API            |
| `formula-chat.ts` | `formula-chat` | 固定公式任务的 Chat 兼容接口     |
| `vision-llm.ts`   | `vision-llm`   | 截图 + PDFium 字符证据的图像 LLM |

## 新增一个厂商

在这里新增例如 `example.ts`，把下面的虚构协议换成厂商的真实文档。所有 URL、模型目录、任务 prompt、请求字段、业务错误及响应解析都留在这个文件。

```ts
import type { OcrAdapter } from "../../../domain/ocr-adapter";
import { formulaLatex } from "../../../domain/ocr";
import { message } from "../../../domain/messages";

const endpoint = (baseUrl: string) => `${baseUrl.replace(/\/+$/, "")}/formula`;

export default {
  id: "example-ocr", // 稳定、唯一，小写字母/数字/连字符
  label: { zh: "示例公式 OCR", en: "Example formula OCR" },
  description: {
    zh: "识别单张公式截图，使用示例厂商的 JSON 接口。",
    en: "Recognizes one formula crop with the example JSON API.",
  },
  order: 40,
  batchSize: 1,
  cachePrefix: "example-ocr-v1",
  endpoint,
  presets: [
    {
      id: "example-ocr", // 预设 ID 也必须全局唯一
      name: "Example OCR",
      buttonLabel: { zh: "添加示例 OCR 预设", en: "Add Example OCR preset" },
      baseUrl: "https://ocr.example.com/v1",
      models: [{ id: "formula-v1" }],
    },
  ],
  async listModels() {
    return [{ id: "formula-v1" }];
  },
  async recognize(context, formulas) {
    const response = await context.transport.json({
      url: endpoint(context.baseUrl),
      auth: { type: "header", name: "x-api-key" },
      body: { engine: context.modelId, image: formulas[0].imageDataUrl },
    });
    const body = response.body as { success?: boolean; latex?: unknown } | null;
    if (!body || body.success !== true)
      throw new Error(message("ocrResponseError", { details: response.details }));
    return [{ id: formulas[0].id, latex: formulaLatex(body.latex) }];
  },
} satisfies OcrAdapter;
```

`presets`、`description`、`order`、`listModels` 都可省略。设置页从同一注册表生成接口选项、预设按钮、请求地址预览及中英文说明。预设内的模型由应用自动附上适配器 ID；不会另存一份下拉菜单模型目录。

## 接口边界

- 契约在 `domain/ocr-adapter.ts`。输入有稳定的公式 `id`、PNG/JPEG data URI 和可选原生字符证据 `evidence`。专用 OCR 可忽略证据；图像 LLM 可使用它。`batchSize` 表示一次调用能接收多少公式，应用负责分批。
- 返回 `{ id, latex }[]`，只返回对应公式的 LaTeX，不混入正文，不合并不同公式。无法可靠识别时返回 `null`；编号与任务特有的 Markdown 包装由适配器处理。业务错误抛出携带脱敏 `response.details` 的 `ocrResponseError`；网络/HTTP 错误由共享传输处理。不要吞掉业务错误，也不要自动重试收费请求或切换厂商。
- `listModels(context)` 可使用自定义 JSON 接口、返回固定模型目录，或省略以调用通用 `/models`。目录是设置页的临时可选列表，用户添加后的模型才持久化。适配器模型列表和识别可以调用同一个 `context.transport`。
- `requiresVision` 用于需要图像 LLM 能力的接口；专用 OCR 本来就处理图片，不需要借助聊天模型的图像能力开关。`vision-llm.ts` 是已有的多模态证据实现。
- 公式语法、原生字符检查、图片回退、译文重排、持久缓存由应用负责。适配器返回候选不等于证明数学正确。连接检查是一个独立的小公式请求。

## 传输与凭据

适配器只看到 `baseUrl`、`modelId` 和 `transport`，不接收 API Key，也不导入 `platform`、keyring、IndexedDB 或 SQL。

`transport.json` 支持 JSON GET/POST，默认 `Authorization: Bearer <key>`；`auth` 可声明自定义 header、query、JSON 字段或 `none`。共享层注入已保存的凭据。带凭据请求限制在配置的提供商 origin；匿名请求可使用其他上传地址。不要把凭据或额外账号密码硬编码在文件、URL、body 或 header 中。

`transport.complete` 复用现有的 OpenAI 兼容流式 Chat 传输，收集为完整字符串；`transport.models` 复用通用模型目录接口。浏览器执行 HTTP 请求，需要厂商 CORS 支持；桌面 JSON 请求交给 `src-tauri/src/ocr_http.rs`，密钥留在 keyring。共享传输保留脱敏错误正文/request ID，120 秒超时，不跟随重定向。JSON 请求体上限为 20 MiB。

当前传输没有 multipart、任意二进制响应或厂商签名鉴权。遇到这些协议时需要先扩展共享传输契约及两端实现，厂商业务规则仍留在适配器。不要绕过传输层自行读取密钥。

## 缓存与兼容性

模型的 `formulaOcr` 保存的是适配器 `id`。发布后不要随意改 ID；缺失的适配器会保留配置并提示不可用，不会静默请求其他收费服务。

候选缓存键为 `<cachePrefix>:<providerId>:<modelId>`。改变识别 prompt、返回规范化或语义规则时更新自己的 `cachePrefix`；纯代码迁移保持它不变。本次迁移保留 GLM/Chat 的 `formula-ocr-v1:<id>` 与图像 LLM 的 `transcribe-v2-native`，因此已有配置和合格候选继续复用。公式裁图缓存还有自己的版本与坐标检查。

## 验证

在 `tests/integration/ocr.test.ts` 为厂商请求/响应补固定夹具；扩展接口契约在 `ocr-adapters.test.ts`，传输两端共用 `tests/fixtures/ocr-http.json`。Node 测试通过 `tests/support/register-ocr.ts` 自动发现同一目录，不能维护另一份厂商列表。测试只使用模拟密钥/响应，不请求真实服务商。

运行方法与测试边界见 [测试维护指南](../../../../tests/README.md)。
