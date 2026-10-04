import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cx } from "./ui/styles";
import type { FormulaAsset } from "../domain/analysis";
import { FORMULA_PATTERN } from "../application/selection-translation";
import { useTranslation } from "react-i18next";

export default function MathMarkdown({
  children,
  className,
  formulas = [],
  formulaRendering = "original",
}: {
  children: string;
  className?: string;
  formulas?: FormulaAsset[];
  /** Source review and translation use the same prepared LaTeX candidates.
   * Missing candidates and partial selections always retain source crops. */
  formulaRendering?: "original" | "latex-candidate";
}) {
  const { t } = useTranslation();
  const source = children.replace(FORMULA_PATTERN, (marker, id: string) => {
    const formula = formulas.find((asset) => asset.formula.id === id)?.formula;
    if (!formula) return marker;
    if (formulaRendering === "latex-candidate" && formula.latex && !formula.partial)
      return formula.mode === "display" ? `\n\n$$\n${formula.latex}\n$$\n\n` : `$${formula.latex}$`;
    return `![formula](cachalot-formula:${id})`;
  });
  // Markdown/KaTeX generate descendants, so typography is scoped here using
  // Tailwind descendant variants instead of global tag selectors.
  return (
    <div
      data-ui="math-markdown"
      className={cx(
        "[overflow-wrap:anywhere] [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-[5px] [&_:is(h1,h2,h3,h4,h5,h6)]:mt-[1em] [&_:is(h1,h2,h3,h4,h5,h6)]:mb-[.55em] [&_:is(h1,h2,h3,h4,h5,h6)]:leading-[1.4] [&_:is(h1,h2,h3,h4,h5,h6)]:font-bold [&_:is(ul,ol)]:my-[1em] [&_:is(ul,ol)]:pl-[22px] [&_h1]:text-[1.6em] [&_h2]:text-[1.35em] [&_h3]:text-[1.18em] [&_h4]:text-[1.08em] [&_h5]:text-[1em] [&_h6]:text-[1em] [&_ol]:list-decimal [&_p]:mb-[10px] [&_p:last-child]:mb-0 [&_pre]:overflow-auto [&_pre]:rounded-[6px] [&_pre]:bg-[#f4f7fa] [&_pre]:p-[10px] [&_ul]:list-disc",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) =>
          url.startsWith("cachalot-formula:") ? url : defaultUrlTransform(url)
        }
        components={{
          img: ({ src, alt }) => {
            const asset = formulas.find((a) => src === `cachalot-formula:${a.formula.id}`);
            if (!asset) return <img src={src} alt={alt || ""} />;
            if (!asset.imageDataUrl)
              return <span className="text-muted">[{t("translation.originalFormula")}]</span>;
            const formula = asset.formula,
              emSize = formula.emSize || 10;
            const baselineOffset =
              formula.baseline === undefined
                ? 0
                : ((formula.box[3] - formula.baseline) * formula.pageHeight) / emSize;
            return (
              <img
                data-ui="preserved-formula"
                data-formula-id={formula.id}
                data-mode={formula.mode}
                src={asset.imageDataUrl}
                alt={t("translation.originalFormula")}
                title={t(
                  formula.partial ? "translation.partialFormula" : "translation.originalFormula",
                )}
                className={
                  formula.mode === "display"
                    ? "my-2 block h-auto max-w-full"
                    : "inline-block h-auto max-w-full"
                }
                style={{
                  width: `${asset.width / asset.scale / emSize}em`,
                  verticalAlign: formula.mode === "inline" ? `${-baselineOffset}em` : undefined,
                }}
              />
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
