/** Provider fixture keeps structural anchors in their original order, while
 * translating headings as plain text (the app must apply Markdown levels). */
export function fixtureTranslation(text: string): string {
  const source = text.split("\n\n公式阅读辅助")[0].slice(text.indexOf("\n") + 1);
  return `Fixture translation.\n\n${source.replace(
    /\[\[heading:([a-zA-Z0-9-]+)\]\]([\s\S]*?)\[\[\/heading:\1\]\]/g,
    (_, id: string, content: string) => {
      const formulas = content.match(/\[\[formula:[a-zA-Z0-9-]+\]\]/g) || [];
      return `[[heading:${id}]]标题译文 ${formulas.join(" ")}[[/heading:${id}]]`;
    },
  )}`;
}
