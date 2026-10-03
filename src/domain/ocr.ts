import { message } from "./messages";

export function validateOcrImage(value: string): void {
  const match = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[1].length > Math.ceil((10 * 1024 * 1024) / 3) * 4)
    throw new Error(message("ocrImageInvalid"));
}

/** Strip transport wrappers only. Do not repair symbols, infer missing math,
 * or merge multiple recognized formulas into a single source region. */
export function formulaLatex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let text = value
    .trim()
    .replace(/^```(?:latex|tex)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();
  const pairs = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["\\(", "\\)"],
    ["$", "$"],
  ];
  for (const [start, end] of pairs)
    if (text.startsWith(start) && text.endsWith(end)) {
      text = text.slice(start.length, -end.length).trim();
      break;
    }
  // Leftover delimiters or markup usually indicate multiple blocks/prose.
  if (!text || /\$|\\[\[\]()]|```|<\/?\w|^#/m.test(text)) return null;
  return text;
}
