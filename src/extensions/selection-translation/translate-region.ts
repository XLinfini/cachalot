import type {
  SelectedRegion,
  TranslationResult,
  TranslationPhase,
  PreparedTranslationSource,
} from "./types";
import { message } from "../../sdk";
import type { Provider } from "../../sdk";
import type { ExtensionContext } from "../../sdk";
import { DEFAULT_TRANSLATION_PROMPT } from "./prompt";
import { TRANSLATION_CONTEXT_POLICY } from "./context";
import { finishTranslation, formulaGlossary, FORMULA_TRANSLATION_POLICY } from "./formula-slots";
import {
  finishTranslatedHeadings,
  HEADING_TRANSLATION_POLICY,
  markedTranslationSource,
} from "./headings";

/** A selection triggers reconstruction first, then prose translation. Page
 * analysis never calls the remote model. Presentation gets the exact candidates
 * used in the translation glossary, even if subsequent translation fails. */
export async function translateRegion(
  context: ExtensionContext,
  selection: SelectedRegion,
  provider: Provider,
  onDelta: (text: string) => void,
  callbacks: {
    onPrepared?: (source: PreparedTranslationSource) => void;
    onPhase?: (phase: TranslationPhase) => void;
    signal?: AbortSignal;
  } = {},
): Promise<TranslationResult> {
  callbacks.onPhase?.("preparing");
  const prompt =
    (await context.workspace.getConfiguration().get("prompt")) || DEFAULT_TRANSLATION_PROMPT;
  const vision = await context.lm.supportsImages(provider);
  if (!selection.text && !vision) throw new Error(message("visionRequired"));
  const { assets, issues } = await context.ocr.reconstructFormulas(selection.formulas || [], {
    fallback: provider,
    supportsImages: vision,
    signal: callbacks.signal,
  });
  const glossary = formulaGlossary(assets);
  callbacks.onPrepared?.({ formulas: assets, issues });
  callbacks.onPhase?.("translating");
  const source = markedTranslationSource(selection);
  const text = `${source}${selection.context ? `\n\n背景材料（仅用于理解，不属于待翻译正文）：\n${JSON.stringify(selection.context)}` : ""}${glossary ? `\n\n公式阅读辅助（不属于待翻译正文）：\n${glossary}` : ""}`;
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
  await context.lm.complete(
    {
      providerId: provider.id,
      modelId: provider.modelId,
      messages: [
        {
          role: "system",
          content: `${prompt}\n\n${FORMULA_TRANSLATION_POLICY}\n\n${HEADING_TRANSLATION_POLICY}\n\n${TRANSLATION_CONTEXT_POLICY}`,
        },
        { role: "user", content },
      ],
    },
    (delta) => {
      answer += delta;
      onDelta(delta);
    },
    callbacks.signal,
  );
  if (!answer.trim()) throw new Error(message("emptyResponse"));
  return finishTranslation(selection.text, finishTranslatedHeadings(selection, answer), assets);
}
