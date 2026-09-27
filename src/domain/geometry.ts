import type { Box, PdfCharacter } from "./analysis";

export const area = (box: Box): number => Math.max(0, box[2] - box[0]) * Math.max(0, box[3] - box[1]);
export function intersection(a: Box, b: Box): number {
  return Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
}
export function containsCenter(region: Box, item: Box): boolean {
  const x = (item[0] + item[2]) / 2;
  const y = (item[1] + item[3]) / 2;
  return x >= region[0] && x <= region[2] && y >= region[1] && y <= region[3];
}
export function union(boxes: Box[]): Box {
  return [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
}

/** Restore only whitespace gaps, never unselected words from the same text run. */
export function characterText(characters: PdfCharacter[], indices: Set<number>): string {
  const ordered = characters.filter(c => indices.has(c.index)).sort((a, b) => a.index - b.index);
  const positions = new Map(characters.map((c, index) => [c.index, index]));
  let result = "";
  let previous: PdfCharacter | undefined;
  for (const character of ordered) {
    if (previous && character.index > previous.index + 1) {
      const gap = characters.slice(positions.get(previous.index)! + 1, positions.get(character.index));
      result += gap.every(c => /^\s*$/u.test(c.text)) ? gap.map(c => c.text).join("") : "\n";
    }
    result += character.text;
    previous = character;
  }
  return result.replace(/\r\n?/g, "\n").trim();
}
