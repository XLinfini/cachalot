import type {
  Box,
  ContentBlock,
  FormulaFragment,
  NativePage,
  PdfCharacter,
} from "../domain/analysis";
import { characterText, union } from "../domain/geometry";

const symbols: Record<string, string> = {
  α: "\\alpha",
  β: "\\beta",
  γ: "\\gamma",
  δ: "\\delta",
  ε: "\\epsilon",
  θ: "\\theta",
  λ: "\\lambda",
  μ: "\\mu",
  π: "\\pi",
  σ: "\\sigma",
  τ: "\\tau",
  φ: "\\phi",
  ω: "\\omega",
  Δ: "\\Delta",
  Ω: "\\Omega",
  Γ: "\\Gamma",
  Σ: "\\Sigma",
  Θ: "\\Theta",
  Φ: "\\Phi",
  Ψ: "\\Psi",
  ψ: "\\psi",
  η: "\\eta",
  ρ: "\\rho",
  ν: "\\nu",
  ξ: "\\xi",
  ζ: "\\zeta",
  "−": "-",
  "–": "-",
  "·": "\\cdot",
  "×": "\\times",
  "≤": "\\le",
  "≥": "\\ge",
  "≠": "\\ne",
  "≈": "\\approx",
  "∞": "\\infty",
  "±": "\\pm",
  "∂": "\\partial",
  "∇": "\\nabla",
  κ: "\\kappa",
  ι: "\\iota",
  υ: "\\upsilon",
  χ: "\\chi",
  ο: "o",
  ς: "\\varsigma",
  ϑ: "\\vartheta",
  ϕ: "\\phi",
  ϖ: "\\varpi",
  ϱ: "\\varrho",
  ϵ: "\\epsilon",
  ϰ: "\\varkappa",
  Λ: "\\Lambda",
  Ξ: "\\Xi",
  Υ: "\\Upsilon",
  Π: "\\Pi",
  Α: "A",
  Β: "B",
  Ε: "E",
  Ζ: "Z",
  Η: "H",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Χ: "X",
};
const functions = /^(sin|cos|tan|arcsin|arccos|arctan|log|ln|exp|min|max|lim)$/;
const greek = /[\u0370-\u03ff]/u;
const operator = /^[=+−–\-*/·×<>≤≥≠≈±]$/u;
const em = (c: PdfCharacter) => c.emSize || c.fontSize;
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const encode = (text: string): string | null => {
  const parts = Array.from(text).map((c) =>
    symbols[c] ? `${symbols[c]} ` : /^[a-zA-Z0-9()[\]=+\-*/.,:| ]$/u.test(c) ? c : null,
  );
  return parts.includes(null) ? null : parts.join("");
};

/** Conservative semantic candidate for one baseline plus simple scripts.
 * Fractions, radicals, stacked limits and unknown symbols stay unrecognized.
 * Even a syntactically valid candidate never supersedes its source appearance. */
export function nativeLatex(chars: PdfCharacter[], pageHeight: number): string | null {
  if (!chars.length || chars.some((c) => !c.origin || !c.emSize)) return null;
  const size = Math.max(...chars.map(em));
  const main = chars.filter((c) => em(c) >= size * 0.88);
  const baseline = median(main.map((c) => c.origin![1]));
  if (main.some((c) => Math.abs(c.origin![1] - baseline) * pageHeight > size * 0.22)) return null;
  let result = "",
    pending = "",
    script: "_" | "^" | null = null;
  const flush = () => {
    if (script) result += `${script}{${pending}}`;
    pending = "";
    script = null;
  };
  for (const c of chars) {
    const value = encode(c.text);
    if (value === null) return null;
    const shift = (c.origin![1] - baseline) * pageHeight;
    const next =
      em(c) < size * 0.85 && Math.abs(shift) > size * 0.09 ? (shift > 0 ? "_" : "^") : null;
    if (next) {
      if (!result) return null;
      if (next !== script) flush();
      script = next;
      pending += value;
    } else {
      flush();
      result += value;
    }
  }
  flush();
  result = result.replace(
    /\b(sin|cos|tan|arcsin|arccos|arctan|log|ln|exp|min|max|lim)\b/g,
    "\\$1 ",
  );
  return result.trim() || null;
}

function padded(box: Box, width: number, height: number): Box {
  return [
    Math.max(0, box[0] - 0.5 / width),
    Math.max(0, box[1] - 0.5 / height),
    Math.min(1, box[2] + 0.5 / width),
    Math.min(1, box[3] + 0.5 / height),
  ];
}

interface Token {
  chars: PdfCharacter[];
  word: string;
  strong: boolean;
  math: boolean;
}
function inlineGroups(
  chars: PdfCharacter[],
  height: number,
  allowItalic: boolean,
): PdfCharacter[][] {
  const tokens: Token[] = [];
  let word: PdfCharacter[] = [];
  const flush = () => {
    if (!word.length) return;
    const text = word.map((c) => c.text).join("");
    const baseSize = Math.max(...word.map(em));
    const hasScript = word.some(
      (c) =>
        em(c) < baseSize * 0.85 &&
        c.origin &&
        word[0].origin &&
        Math.abs(c.origin[1] - word[0].origin[1]) * height > baseSize * 0.09,
    );
    const strong =
      greek.test(text) ||
      (hasScript && text.length <= 6) ||
      (allowItalic && word.some((c) => c.italic) && text.length <= 2);
    tokens.push({
      chars: word,
      word: text,
      strong,
      math: strong || functions.test(text) || /^\d+$/.test(text),
    });
    word = [];
  };
  let previous: PdfCharacter | undefined;
  for (const c of chars) {
    if (previous && c.index > previous.index + 1) flush();
    previous = c;
    if (/\s/u.test(c.text)) {
      flush();
      continue;
    }
    if (/^[\p{L}\p{N}]$/u.test(c.text)) word.push(c);
    else {
      flush();
      tokens.push({
        chars: [c],
        word: c.text,
        strong: false,
        math: operator.test(c.text) || /^[()[\]]$/.test(c.text),
      });
    }
  }
  flush();
  const groups: PdfCharacter[][] = [];
  for (let i = 0; i < tokens.length;) {
    if (!tokens[i].math) {
      i++;
      continue;
    }
    let end = i,
      strong = false;
    while (end < tokens.length && tokens[end].math) {
      if (end > i) {
        const a = tokens[end - 1].chars.at(-1)!,
          b = tokens[end].chars[0];
        if (b.box[0] - a.box[2] > 0.04) break;
        if (
          a.origin &&
          b.origin &&
          Math.abs(a.origin[1] - b.origin[1]) * height > Math.max(em(a), em(b)) * 0.9
        )
          break;
      }
      strong ||= tokens[end].strong;
      end++;
    }
    if (strong) {
      // Parentheses belonging to ordinary prose are not absorbed into a formula.
      let start = i;
      while (start < end && /^[()[\]]$/.test(tokens[start].word)) start++;
      const joined = tokens.slice(start, end).flatMap((t) => t.chars);
      while (
        joined.length &&
        joined.at(-1)!.text === ")" &&
        joined.filter((c) => c.text === ")").length > joined.filter((c) => c.text === "(").length
      )
        joined.pop();
      if (joined.length) groups.push(joined);
    }
    i = Math.max(end, i + 1);
  }
  return groups;
}

export function analyzeFormulas(
  documentId: string,
  page: NativePage,
  blocks: ContentBlock[],
): FormulaFragment[] {
  const byIndex = new Map(page.characters.map((c) => [c.index, c]));
  const result: FormulaFragment[] = [];
  for (const block of blocks) {
    const chars = block.characterIndices
      .map((i) => byIndex.get(i)!)
      .filter(Boolean)
      .sort((a, b) => a.index - b.index);
    const groups =
      block.kind === "formula"
        ? [chars]
        : ["paragraph", "caption", "list", "heading", "title", "footnote"].includes(block.kind)
          ? inlineGroups(chars, page.height, ["paragraph", "caption", "list"].includes(block.kind))
          : [];
    for (const group of groups) {
      if (!group.length && block.kind !== "formula") continue;
      const box =
        block.kind === "formula"
          ? union([block.box, ...group.map((c) => c.box)])
          : union(group.map((c) => c.box));
      const mode = block.kind === "formula" ? "display" : "inline";
      const latex = mode === "inline" ? nativeLatex(group, page.height) : null;
      const size = group.length ? Math.max(...group.map(em)) : undefined;
      const main = group.filter((c) => c.origin && em(c) >= (size || 0) * 0.88);
      result.push({
        id: `p${page.page}-${mode}-${group[0]?.index ?? block.id}-${group.at(-1)?.index ?? "empty"}`,
        documentId,
        page: page.page,
        pageWidth: page.width,
        pageHeight: page.height,
        mode,
        blockId: block.id,
        box: padded(box, page.width, page.height),
        characterIndices: group.map((c) => c.index),
        nativeText: characterText(page.characters, new Set(group.map((c) => c.index))),
        latex,
        recognition: latex ? "native-candidate" : "unrecognized",
        baseline: main.length ? median(main.map((c) => c.origin![1])) : undefined,
        emSize: size,
      });
    }
  }
  return result;
}
