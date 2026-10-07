import type { SelectedRegion, TranslationPhase } from "./types";
import { useEffect, useRef, useState } from "react";
import { Check, Code2, Copy, Eye, Languages, RefreshCw, X } from "lucide-react";
import type { ExtensionContext, Provider } from "../../sdk";
import { translateRegion } from "./translate-region";

import type { FormulaAsset, FormulaPreparationIssue } from "../../sdk";
import {
  FORMULA_PATTERN,
  formulaClipboard,
  previewTranslatedHeadings,
  sourceMarkdown,
} from "./index";
import { MathMarkdown, ui, useActiveModel } from "../../sdk/react";
import { useExtensionTranslation } from "../../sdk/react";
import { message } from "../../sdk";
import { localizeMessage } from "../../sdk/react";

interface Props {
  selection: SelectedRegion;
  context: ExtensionContext;
  signal: AbortSignal;
  onClose: () => void;
}

export default function TranslationPopup({ selection, context, signal, onClose }: Props) {
  const provider: Provider | null = useActiveModel(context);
  const { t } = useExtensionTranslation(context);
  const [translation, setTranslation] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formulas, setFormulas] = useState<FormulaAsset[]>([]);
  const [showSourceLatex, setShowSourceLatex] = useState(false);
  const [validated, setValidated] = useState(false);
  const [phase, setPhase] = useState<TranslationPhase>("preparing");
  const [issues, setIssues] = useState<FormulaPreparationIssue[]>([]);
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);

  const translate = async () => {
    // Read the host at each invocation; enabled models and current choices can change while the view is open.
    const provider = context.lm.activeModel;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const request = ++generation.current;
    setValidated(false);
    setTranslation("");
    setFormulas([]);
    setIssues([]);
    setPhase("preparing");
    if (!provider?.modelId) {
      setRunning(false);
      setError(message("configureTranslation"));
      return;
    }
    setError("");
    setRunning(true);
    try {
      const result = await translateRegion(
        context,
        selection,
        provider,
        (delta) => {
          if (request === generation.current) setTranslation((text) => text + delta);
        },
        {
          signal: AbortSignal.any([controller.signal, signal]),
          onPrepared: (source) => {
            if (request === generation.current) {
              setFormulas(source.formulas);
              setIssues(source.issues);
            }
          },
          onPhase: (next) => {
            if (request === generation.current) setPhase(next);
          },
        },
      );
      if (request === generation.current) {
        setTranslation(result.markdown);
        setFormulas(result.formulas);
        setValidated(true);
      }
    } catch (cause) {
      if (request === generation.current) {
        setError(String(cause));
        setTranslation("");
      }
    } finally {
      if (request === generation.current) setRunning(false);
    }
  };

  useEffect(() => {
    void translate();
    return () => {
      generation.current++;
      pending.current?.abort();
    };
  }, [selection, provider?.id, provider?.modelId, signal]);

  // Before preparation finishes, native candidates can already be inspected.
  // Afterwards use the same assets/candidates the translation request received.
  const sourceFormulas = formulas.length
    ? formulas
    : (selection.formulas || []).map((formula) => ({
        formula,
        imageDataUrl: "",
        width: 0,
        height: 0,
        scale: 1,
      }));
  const reconstructedSource = sourceMarkdown(selection);
  const sourceText = formulaClipboard(reconstructedSource, sourceFormulas).replace(
    FORMULA_PATTERN,
    () => `[${t("translation.originalFormula")}]`,
  );

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-[#1c2b42]/45 p-6"
      onMouseDown={onClose}
    >
      <section
        data-ui="translation-popup"
        className="flex max-h-[90vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_25px_60px_#0e254858]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-[11px] border-b border-[#e9eef5] px-[22px] py-[17px]">
          <div className="grid size-[34px] place-items-center rounded-button bg-[#e9f2ff] text-[#2b71d1]">
            <Languages size={20} />
          </div>
          <div className="flex-1">
            <small className="text-[9px] tracking-[.12em] text-[#7d97b8]">
              {t("translation.eyebrow", { page: selection.page })}
            </small>
            <h2 className="mt-[3px] mb-0 text-[17px]">{t("translation.title")}</h2>
          </div>
          <button className={ui.iconButton} onClick={onClose} aria-label={t("translation.close")}>
            <X size={20} />
          </button>
        </header>
        <div className="grid min-h-0 grid-cols-[1fr_1.05fr_1.05fr] overflow-hidden">
          <div
            data-ui="translation-source"
            className="min-w-0 overflow-auto border-r border-[#e8edf4] bg-[#f8fafd] px-[21px] py-[19px]"
          >
            <div className="mb-4 flex justify-between gap-3 text-[11px] font-bold text-[#617b9b]">
              {t("translation.source")}
            </div>
            <img
              className="h-auto max-w-full bg-white shadow-[0_2px_8px_#1a375622]"
              src={selection.imageDataUrl}
              alt={t("translation.imageAlt", { page: selection.page })}
            />
          </div>
          <div
            data-ui="translation-reconstructed-source"
            className="min-w-0 overflow-auto border-r border-[#e8edf4] px-[21px] py-[19px]"
          >
            <div className="mb-4 flex items-center justify-between gap-3 text-[11px] font-bold text-[#617b9b]">
              {t("translation.reconstructedSource")}
              <button
                data-ui="translation-source-format"
                className={ui.iconButton}
                aria-label={t(
                  showSourceLatex ? "translation.showRenderedSource" : "translation.latexSource",
                )}
                title={t(
                  showSourceLatex ? "translation.showRenderedSource" : "translation.latexSource",
                )}
                aria-pressed={showSourceLatex}
                onClick={() => setShowSourceLatex((value) => !value)}
              >
                {showSourceLatex ? <Eye size={16} /> : <Code2 size={16} />}
              </button>
            </div>
            {showSourceLatex ? (
              <p
                data-ui="translation-source-text"
                className="font-mono text-[12px] leading-[1.85] [overflow-wrap:anywhere] whitespace-pre-wrap"
              >
                {sourceText}
              </p>
            ) : (
              <MathMarkdown
                formulas={sourceFormulas}
                formulaRendering="latex-candidate"
                className="text-[12px] leading-[1.85] text-[#415b78]"
              >
                {reconstructedSource || t("translation.noExtractedText")}
              </MathMarkdown>
            )}
            {!!issues.length && (
              <div
                data-ui="formula-preparation-warning"
                role="status"
                className="mt-3 rounded-button bg-[#fff7eb] p-3 text-[10px] leading-[1.6] text-[#946216]"
              >
                <p>{t("translation.formulaFallback", { count: issues.length })}</p>
                {[...new Set(issues.map((issue) => issue.reason))].map((reason) => (
                  <p key={reason}>{t(`translation.formulaIssue.${reason}`)}</p>
                ))}
                {[
                  ...new Set(issues.flatMap((issue) => (issue.details ? [issue.details] : []))),
                ].map((details) => (
                  <p key={details} className="mt-2 [overflow-wrap:anywhere] whitespace-pre-wrap">
                    {localizeMessage(details)}
                  </p>
                ))}
              </div>
            )}
            {!!selection.formulas?.length && (
              <p className="mt-3 text-[10px] text-[#617b9b]">
                {t("translation.formulaPreservation", { count: selection.formulas.length })}
              </p>
            )}
          </div>
          <div data-ui="translation-result" className="min-w-0 overflow-auto px-[21px] py-[19px]">
            <div className="mb-4 flex justify-between gap-3 text-[11px] font-bold text-[#617b9b]">
              {t("translation.result")}{" "}
              <span className="text-[10px] font-normal text-[#a0afbf]">
                {provider ? `${provider.name} · ${provider.modelId}` : t("translation.noModel")}
              </span>
            </div>
            {running && !translation && (
              <p
                data-ui="translation-progress"
                data-phase={phase}
                role="status"
                className="text-muted"
              >
                {t(phase === "preparing" ? "translation.preparing" : "translation.running")}
              </p>
            )}
            {translation && (
              <MathMarkdown
                formulas={formulas}
                formulaRendering="latex-candidate"
                className="text-[12px] leading-[1.85]"
              >
                {previewTranslatedHeadings(translation, selection.blocks)}
              </MathMarkdown>
            )}
            {error && (
              <p data-ui="translation-error" role="alert" className={ui.formError}>
                {localizeMessage(error)}
              </p>
            )}
          </div>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-[#e9eef5] px-[21px] py-[13px] text-[10px] text-[#98a7b9]">
          <span>{t("translation.verify")}</span>
          <div className="flex gap-2">
            <button
              className={ui.secondaryButton}
              disabled={running || !provider}
              onClick={() => void translate()}
            >
              <RefreshCw size={15} />
              {t("common.retry")}
            </button>
            <button
              className={ui.primaryButton}
              disabled={!translation || !validated}
              onClick={() => {
                void navigator.clipboard
                  .writeText(formulaClipboard(translation, formulas))
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1800);
                  });
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? t("common.copied") : t("translation.copy")}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
