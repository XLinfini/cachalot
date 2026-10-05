import type { ExtensionManifest } from "../../sdk";
import { DEFAULT_TRANSLATION_PROMPT } from "./prompt";
export const manifest: ExtensionManifest = {
  publisher: "cachalot",
  name: "selection-translation",
  version: "0.1.0",
  displayName: { zh: "选区翻译", en: "Selection translation" },
  description: {
    zh: "翻译完整段落、行间公式或精确选中的文字，并核对原文与公式。",
    en: "Translate complete paragraphs, display formulas or selected text and review the source.",
  },
  engines: { cachalot: "^0.1.0" },
  activationEvents: ["onStartupFinished"],
  capabilities: ["documents.read", "reader.interact", "reader.decorate", "ocr", "lm"],
  contributes: {
    commands: [
      {
        command: "cachalot.selection-translation.translate",
        title: { zh: "翻译选区", en: "Translate selection" },
      },
    ],
    views: [
      {
        id: "cachalot.selection-translation.result",
        title: { zh: "选区翻译", en: "Selection translation" },
        location: "modal",
      },
      {
        id: "cachalot.selection-translation.settings",
        title: { zh: "阅读与翻译", en: "Reading & translation" },
        location: "settings",
      },
    ],
    configuration: [
      {
        key: "prompt",
        title: { zh: "翻译提示词", en: "Translation prompt" },
        default: DEFAULT_TRANSLATION_PROMPT,
      },
    ],
  },
};
