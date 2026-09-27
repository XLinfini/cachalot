import { useEffect, useRef, useState } from "react";
import { Check, Copy, Languages, RefreshCw, X } from "lucide-react";
import { services } from "../application/services";
import type { Provider } from "../domain/records";
import type { FormulaAsset, SelectedRegion } from "../domain/analysis";
import { formulaClipboard } from "../application/formula-references";
import MathMarkdown from "./MathMarkdown";
import { ui } from "./ui/styles";
import { useTranslation } from "react-i18next";
import { message } from "../domain/messages";
import { localizeMessage } from "../i18n/messages";

interface Props {
  selection: SelectedRegion;
  provider: Provider | null;
  onClose: () => void;
}

export default function TranslationPopup({ selection, provider, onClose }: Props) {
  const { t } = useTranslation();
  const [translation, setTranslation] = useState("");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [formulas, setFormulas] = useState<FormulaAsset[]>([]);
  const [validated, setValidated] = useState(false);
  const generation = useRef(0);
  const automaticRun = useRef<{
    selection: SelectedRegion;
    providerId: string | null;
    modelId: string | null;
  } | null>(null);

  const translate = async () => {
    const request = ++generation.current;
    setValidated(false);
    if (!provider?.modelId) {
      setError(message("configureTranslation"));
      return;
    }
    setError("");
    setTranslation("");
    setFormulas([]);
    setRunning(true);
    try {
      const result = await services.assistant.translateRegion(
        selection,
        provider,
        (delta) => {
          if (request === generation.current) setTranslation((text) => text + delta);
        },
        (sources) => {
          if (request === generation.current) setFormulas(sources);
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
    if (
      automaticRun.current?.selection === selection &&
      automaticRun.current.providerId === (provider?.id || null) &&
      automaticRun.current.modelId === (provider?.modelId || null)
    )
      return;
    automaticRun.current = {
      selection,
      providerId: provider?.id || null,
      modelId: provider?.modelId || null,
    };
    void translate();
  }, [selection, provider?.id, provider?.modelId]);

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-[#1c2b42]/45 p-6"
      onMouseDown={onClose}
    >
      <section
        data-ui="translation-popup"
        className="flex max-h-[min(82vh,780px)] w-full max-w-[800px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_25px_60px_#0e254858]"
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
        <div className="grid min-h-0 grid-cols-2 overflow-auto">
          <div
            data-ui="translation-source"
            className="overflow-auto border-r border-[#e8edf4] bg-[#f8fafd] px-[21px] py-[19px]"
          >
            <div className="mb-4 flex justify-between gap-3 text-[11px] font-bold text-[#617b9b]">
              {t("translation.source")}
            </div>
            <img
              className="h-auto max-w-full bg-white shadow-[0_2px_8px_#1a375622]"
              src={selection.imageDataUrl}
              alt={t("translation.imageAlt", { page: selection.page })}
            />
            {selection.text && (
              <details className="mt-[14px] text-[10px] text-[#7389a3]">
                <summary>{t("translation.extracted")}</summary>
                <p className="leading-[1.6] whitespace-pre-wrap">
                  {formulaClipboard(
                    selection.text,
                    (selection.formulas || []).map((formula) => ({
                      formula,
                      imageDataUrl: "",
                      width: 0,
                      height: 0,
                      scale: 1,
                    })),
                  )}
                </p>
              </details>
            )}
            {!!selection.formulas?.length && (
              <p className="mt-3 text-[10px] text-[#617b9b]">
                {t("translation.formulaPreservation", { count: selection.formulas.length })}
              </p>
            )}
          </div>
          <div data-ui="translation-result" className="overflow-auto px-[21px] py-[19px]">
            <div className="mb-4 flex justify-between gap-3 text-[11px] font-bold text-[#617b9b]">
              {t("translation.result")}{" "}
              <span className="text-[10px] font-normal text-[#a0afbf]">
                {provider ? `${provider.name} · ${provider.modelId}` : t("translation.noModel")}
              </span>
            </div>
            {running && !translation && <p className="text-muted">{t("translation.running")}</p>}
            {translation && (
              <MathMarkdown formulas={formulas} className="text-[12px] leading-[1.85]">
                {translation}
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
