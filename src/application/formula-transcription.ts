import katex from "katex";
import type { FormulaFragment } from "../domain/analysis";
import { formulaEvidence } from "../domain/formula-evidence";
export {
  formulaEvidence,
  FORMULA_TRANSCRIPTION_PROMPT,
  TRANSCRIPTION_VERSION,
} from "../domain/formula-evidence";

export function validLatex(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 12000 ||
    /\\(?:href|url|includegraphics|html|def|newcommand|require)\b/.test(value)
  )
    return false;
  try {
    katex.renderToString(value, { throwOnError: true, trust: false, strict: "error" });
    return true;
  } catch {
    return false;
  }
}

const lettersAndDigits = (text: string) => text.normalize("NFKC").match(/[\p{L}\p{N}]/gu) || [];
const count = (characters: string[]) => {
  const result = new Map<string, number>();
  for (const character of characters) result.set(character, (result.get(character) || 0) + 1);
  return result;
};

/** Necessary character check, NOT proof of mathematical or spatial correctness.
 * Compare rendered MathML leaves, not command names (e.g. `frac`/`mathrm`).
 * Require extracted letters/digits to survive, allowing extra ones because
 * path/bitmap glyphs can be absent from PDFium. Operators and 2D structure still
 * need visual review; native character evidence can itself be incomplete. */
export function preservesNativeCharacters(formula: FormulaFragment, latex: string): boolean {
  const evidence = formulaEvidence(formula);
  const expected = count(
    evidence.glyphs
      .filter((c) => !c.generated && c.role === "body")
      .flatMap((c) => lettersAndDigits(c.text)),
  );
  if (!expected.size) return true;
  const mathml = katex.renderToString(latex, {
    output: "mathml",
    throwOnError: true,
    trust: false,
  });
  const leaves = [...mathml.matchAll(/<(mi|mn|mo|mtext)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].map(
    (match) =>
      match[2]
        .replace(/<[^>]*>/g, "")
        .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) =>
          String.fromCodePoint(code.startsWith("x") ? parseInt(code.slice(1), 16) : Number(code)),
        )
        .replace(/&(?:amp|lt|gt|quot|apos);/g, " "),
  );
  const actual = count(lettersAndDigits(leaves.join("")));
  return [...expected].every(([character, amount]) => (actual.get(character) || 0) >= amount);
}
