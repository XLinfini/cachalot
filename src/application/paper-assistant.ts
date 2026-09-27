import { message } from "../domain/messages";
import type {
  PreparedTranslationSource,
  SelectedRegion,
  TranslationPhase,
  TranslationResult,
} from "../domain/analysis";
import type { ChatMessage, DocumentRecord, Provider } from "../domain/records";
import { platform } from "../infrastructure/platform";
import { DEFAULT_TRANSLATION_PROMPT } from "./prompts";
import { supportsImages } from "./model-catalog";
import { prepareFormulas } from "./formula-translation";
import { finishTranslation, FORMULA_TRANSLATION_POLICY } from "./formula-references";

export function relevantPages(
  question: string,
  pages: Array<[number, string]>,
  currentPage: number,
): Array<[number, string]> {
  const terms = [...new Set(question.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])];
  return pages
    .map(([number, text]) => ({
      number,
      text,
      score:
        (number === currentPage ? 2 : 0) +
        terms.reduce(
          (score, term) => score + Math.min(5, text.toLowerCase().split(term).length - 1),
          0,
        ),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(({ number, text }) => [number, text.slice(0, 7000)]);
}

export async function askPaper(
  input: {
    document: DocumentRecord;
    page: number;
    selection: SelectedRegion | null;
    provider: Provider;
    question: string;
    history: ChatMessage[];
  },
  onDelta: (text: string) => void,
): Promise<string> {
  const { document, page, selection, provider, question, history } = input;
  const pages = await platform.listPageText(document.id, document.pageCount);
  const excerpts = relevantPages(question, pages, page)
    .map(([number, text]) => `[第 ${number} 页]\n${text}`)
    .join("\n\n");
  const context = `你是一名学术论文阅读助手。根据给定的论文文本和用户附图回答，缺少证据时明确说明。回答使用简体中文，尽量标注页码。公式用 LaTeX。论文：《${document.title}》。\n\n相关页面：\n${excerpts || "页面文字仍在索引中，请说明目前无法获取论文文本。"}${selection ? `\n\n当前选区（第 ${selection.page} 页）：\n${selection.text}` : ""}`;
  const vision = await supportsImages(provider);
  if (history.at(-1)?.images?.length && !vision) throw new Error(message("imageUnsupported"));
  let answer = "";
  await platform.complete(
    {
      providerId: provider.id,
      modelId: provider.modelId,
      messages: [
        { role: "system", content: context },
        ...history
          .slice(-12)
          .map((message) => ({
            role: message.role,
            content: conversationContent(message, vision),
          })),
      ],
    },
    (delta) => {
      answer += delta;
      onDelta(delta);
    },
  );
  if (!answer.trim()) throw new Error(message("emptyResponse"));
  return answer;
}

/** A selection triggers reconstruction first, then prose translation. Page
 * analysis never calls the remote model. Presentation gets the exact candidates
 * used in the translation glossary, even if subsequent translation fails. */
export async function translateRegion(
  selection: SelectedRegion,
  provider: Provider,
  onDelta: (text: string) => void,
  callbacks: {
    onPrepared?: (source: PreparedTranslationSource) => void;
    onPhase?: (phase: TranslationPhase) => void;
  } = {},
): Promise<TranslationResult> {
  callbacks.onPhase?.("preparing");
  const prompt = (await platform.getSetting("translationPrompt")) || DEFAULT_TRANSLATION_PROMPT;
  const vision = await supportsImages(provider);
  if (!selection.text && !vision) throw new Error(message("visionRequired"));
  const { assets, glossary, issues } = await prepareFormulas(selection, provider, vision);
  callbacks.onPrepared?.({ formulas: assets, issues });
  callbacks.onPhase?.("translating");
  const text = `${selection.text}${glossary ? `\n\n公式阅读辅助（不属于待翻译正文）：\n${glossary}` : ""}`;
  const content: unknown = vision
    ? [
        {
          type: "text",
          text: `第 ${selection.page} 页选区。可提取正文如下，请结合图像校正并翻译；图表内部标签不属于正文：\n${text || "（未提取到正文）"}`,
        },
        { type: "image_url", image_url: { url: selection.imageDataUrl } },
      ]
    : `第 ${selection.page} 页选区正文：\n${text}`;
  let answer = "";
  await platform.complete(
    {
      providerId: provider.id,
      modelId: provider.modelId,
      messages: [
        { role: "system", content: `${prompt}\n\n${FORMULA_TRANSLATION_POLICY}` },
        { role: "user", content },
      ],
    },
    (delta) => {
      answer += delta;
      onDelta(delta);
    },
  );
  if (!answer.trim()) throw new Error(message("emptyResponse"));
  return finishTranslation(selection.text, answer, assets);
}

/** Preserve user images in vision requests; historical images are omitted when
 * switching to a text model. Current-image questions are rejected above. */
export function conversationContent(entry: ChatMessage, vision: boolean): unknown {
  if (!entry.images?.length) return entry.content;
  if (!vision)
    return [
      entry.content,
      "（此消息曾包含图片，当前模型无法读取图片。请根据已有文字回答，不要猜测图像内容。）",
    ]
      .filter(Boolean)
      .join("\n");
  return [
    ...(entry.content ? [{ type: "text", text: entry.content }] : []),
    ...entry.images.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
  ];
}
