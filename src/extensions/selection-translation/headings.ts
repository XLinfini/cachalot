import type { SelectedRegion, SelectedTextBlock } from "./types";

import { message } from "../../sdk";

const HEADING_TOKEN = /\[\[(\/?)heading:([a-zA-Z0-9-]+)\]\]/g;
const singleLine = (text: string) => text.replace(/\s+/gu, " ").trim();
const opening = (id: string) => `[[heading:${id}]]`;
const closing = (id: string) => `[[/heading:${id}]]`;

const selectedHeadings = (selection: SelectedRegion) =>
  (selection.blocks || []).filter((block) => block.headingLevel);

/** Plain selection.text remains available for chat/existing callers. Source
 * review reconstructs headings locally, without requiring a model response. */
export function sourceMarkdown(selection: SelectedRegion): string {
  if (!selectedHeadings(selection).length) return selection.text;
  return selection
    .blocks!.map((block) =>
      block.headingLevel
        ? `${"#".repeat(block.headingLevel)} ${singleLine(block.text)}`
        : block.text,
    )
    .join("\n\n");
}

export const HEADING_TRANSLATION_POLICY =
  "输入中的 [[heading:ID]] 与 [[/heading:ID]] 包住原文标题（含论文主标题及小节标题）。逐一翻译标题内容，原样保留成对标记、ID、顺序及标题与后续正文的边界，每对只出现一次，不新增标记，不把正文放入标题。不需要自己添加 # 标题前缀，程序会恢复原层级。即使标题只被部分选中，也仅翻译标记内已有文字，禁止补全未选中的标题。标题中的 [[formula:ID]] 仍必须原样保留。";

/** Stable block identities make formatting independent of LLM Markdown style. */
export function markedTranslationSource(selection: SelectedRegion): string {
  if (!selectedHeadings(selection).length) return selection.text;
  return selection
    .blocks!.map((block) =>
      block.headingLevel
        ? `${opening(block.id)}\n${singleLine(block.text)}\n${closing(block.id)}`
        : block.text,
    )
    .join("\n\n");
}

function headingMarkdown(block: SelectedTextBlock, text: string): string {
  // Some models redundantly add Markdown hashes despite the marker contract.
  // Remove those prefixes, join wrapped title lines, then apply the source level.
  const value = singleLine(text.replace(/^\s{0,3}#{1,6}[ \t]+/gm, ""));
  return `${"#".repeat(block.headingLevel!)} ${value}`;
}

/** Streaming preview hides protocol markers. Final conversion below additionally
 * validates pairs/order/nonempty content, before enabling copy or later export. */
export function previewTranslatedHeadings(
  markdown: string,
  blocks: SelectedTextBlock[] = [],
): string {
  const byId = new Map(blocks.filter((b) => b.headingLevel).map((b) => [b.id, b]));
  let result = markdown.replace(
    /\[\[heading:([a-zA-Z0-9-]+)\]\]([\s\S]*?)\[\[\/heading:\1\]\]/g,
    (_, id: string, text: string) =>
      byId.has(id) ? `\n\n${headingMarkdown(byId.get(id)!, text)}\n\n` : text,
  );
  result = result.replace(HEADING_TOKEN, (_, end: string, id: string) =>
    !end && byId.has(id) ? `\n\n${"#".repeat(byId.get(id)!.headingLevel!)} ` : "\n\n",
  );
  return result;
}

export function finishTranslatedHeadings(selection: SelectedRegion, markdown: string): string {
  const headings = selectedHeadings(selection);
  // Models sometimes wrap the entire Markdown answer as a code sample. Inside
  // that fence, locally restored '#' lines would render as code, not headings.
  if (headings.length) {
    const wrapper = markdown
      .trim()
      .match(/^(`{3,}|~{3,})(?:markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n\1$/i);
    if (wrapper) markdown = wrapper[2];
  }
  const expected = headings.flatMap((block) => [opening(block.id), closing(block.id)]);
  const actual = [...markdown.matchAll(HEADING_TOKEN)].map((match) => match[0]);
  if (JSON.stringify(expected) !== JSON.stringify(actual))
    throw new Error(message("headingReferencesChanged"));
  for (const block of headings) {
    const start = markdown.indexOf(opening(block.id)) + opening(block.id).length;
    const end = markdown.indexOf(closing(block.id));
    if (!singleLine(markdown.slice(start, end).replace(/^\s*#{1,6}[ \t]+/gm, "")))
      throw new Error(message("headingReferencesChanged"));
  }
  return previewTranslatedHeadings(markdown, headings);
}
