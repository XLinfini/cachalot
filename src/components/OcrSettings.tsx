import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import type { OcrSelection } from "../application/ocr";
import type { Provider } from "../domain/records";
import { ocrModels } from "../domain/provider-models";
import ModelPicker from "./ModelPicker";
import ProviderEditor from "./ProviderEditor";
import { cx, ui } from "../sdk/ui/styles";

export default function OcrSettings({
  providers,
  activeProviderId,
  onProvidersChange,
  onActiveProviderChange,
  onError,
}: {
  providers: Provider[];
  activeProviderId: string | null;
  onProvidersChange: (providers: Provider[]) => void;
  onActiveProviderChange: (id: string | null) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [selection, setSelection] = useState<OcrSelection>(null);
  const [mode, setMode] = useState("current");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void services.ocr
      .getSelection()
      .then((value) => {
        setSelection(value);
        setMode(value === "off" ? "off" : value ? "separate" : "current");
      })
      .catch((error) => {
        setMode("separate");
        onError(String(error));
      })
      .finally(() => setReady(true));
  }, []);
  const configured =
    selection && selection !== "off"
      ? providers.find(
          (p) =>
            p.id === selection.providerId &&
            p.enabled &&
            ocrModels(p).some((m) => m.id === selection.modelId),
        )
      : null;
  const selected =
    configured && selection && selection !== "off"
      ? { ...configured, modelId: selection.modelId }
      : null;
  const save = async (value: OcrSelection) => {
    setBusy(true);
    try {
      await services.ocr.select(value);
      setSelection(value);
    } catch (error) {
      setMode(selection === "off" ? "off" : selection ? "separate" : "current");
      onError(String(error));
    } finally {
      setBusy(false);
    }
  };
  const openProviders = () =>
    document.getElementById("ocr-provider-editor")?.scrollIntoView({ behavior: "smooth" });
  return (
    <main data-ui="ocr-settings" className={ui.settingsPage}>
      <div className={ui.eyebrowBlue}>{t("ocr.eyebrow")}</div>
      <h1 className="mt-3 mb-2 text-[27px]">{t("ocr.title")}</h1>
      <p className="mb-8 text-[12px] leading-6 text-muted">{t("ocr.description")}</p>
      <section className={cx(ui.surface, "max-w-[720px] space-y-5 p-6")}>
        <label className={ui.fieldLabel} htmlFor="ocr-mode">
          {t("ocr.mode")}
        </label>
        <select
          id="ocr-mode"
          className={ui.fieldInput}
          value={mode}
          disabled={!ready || busy}
          onChange={(e) => {
            const mode = e.target.value;
            setMode(mode);
            if (mode !== "separate") void save(mode === "off" ? "off" : null);
          }}
        >
          <option value="current">{t("ocr.current")}</option>
          <option value="separate">{t("ocr.separate")}</option>
          <option value="off">{t("ocr.off")}</option>
        </select>
        <p className="text-[11px] leading-6 text-muted">{t("ocr.flowHint")}</p>
        {mode === "separate" && (
          <>
            <p className="text-[11px] leading-6 text-muted">{t("ocr.modelsHint")}</p>
            {selected && (
              <p data-ui="selected-ocr-model" className="text-[12px] text-brand">
                {selected.name} · {selected.modelId}
              </p>
            )}
            {!selected && (
              <p className="text-[11px] text-amber-700">{t("ocr.selectionRequired")}</p>
            )}
            <div className="flex items-center gap-4 pt-3">
              <button className={ui.secondaryButton} onClick={openProviders}>
                {t("ocr.manageProviders")}
              </button>
              <ModelPicker
                purpose="ocr"
                providers={providers}
                selected={selected}
                vision={false}
                disabled={busy || !ready}
                onSelect={(providerId, modelId) => void save({ providerId, modelId })}
                onOpenSettings={openProviders}
              />
            </div>
          </>
        )}
        <p className="text-[11px] leading-6 text-muted">{t("ocr.savedAutomatically")}</p>
      </section>
      <ProviderEditor
        purpose="ocr"
        embedded
        providers={providers}
        activeProviderId={activeProviderId}
        onProvidersChange={onProvidersChange}
        onActiveProviderChange={onActiveProviderChange}
        onError={onError}
      />
    </main>
  );
}
