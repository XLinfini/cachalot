import { useEffect, useState } from "react";
import { ChevronLeft, Database, HardDrive, Layers3, Languages, Settings2 } from "lucide-react";
import type { Provider } from "../domain/records";
import { cx, ui } from "../sdk/ui/styles";
import { useTranslation } from "react-i18next";
import { changeUiLanguage, type UiLanguage } from "../i18n";
import { message } from "../domain/messages";
import OcrSettings from "./OcrSettings";
import ProviderEditor from "./ProviderEditor";
import CacheSettings from "./CacheSettings";
import {
  ExtensionSettings,
  ExtensionView,
  label,
  useExtensions,
} from "./extensions/ExtensionWorkbench";

interface Props {
  providers: Provider[];
  activeProviderId: string | null;
  onProvidersChange: (providers: Provider[]) => void;
  onActiveProviderChange: (id: string | null) => void;
  onBack: () => void;
  onError: (message: string) => void;
}

export default function ProviderSettings({
  providers,
  activeProviderId,
  onProvidersChange,
  onActiveProviderChange,
  onBack,
  onError,
}: Props) {
  const { t, i18n } = useTranslation();
  const [languageBusy, setLanguageBusy] = useState(false);
  const [section, setSection] = useState("providers");
  const extensions = useExtensions();
  const pluginViews = extensions.views.filter((view) => view.declaration.location === "settings");
  const pluginView = pluginViews.find((view) => view.declaration.id === section);
  useEffect(() => {
    if (!["general", "providers", "ocr", "cache", "extensions"].includes(section) && !pluginView)
      setSection("extensions");
  }, [section, pluginView]);

  const setLanguage = async (language: UiLanguage) => {
    setLanguageBusy(true);
    try {
      await changeUiLanguage(language);
    } catch {
      onError(message("languageSaveFailed"));
    } finally {
      setLanguageBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full bg-white">
      <aside className="w-[248px] flex-none border-r border-[#e8edf4] bg-canvas px-[18px] py-[22px] max-compact:w-[190px] [&>h1]:mx-[10px] [&>h1]:mt-[9px] [&>h1]:mb-[34px] [&>h1]:text-[24px]">
        <button className={cx(ui.backLink, "mb-[50px]")} onClick={onBack}>
          <ChevronLeft size={17} />
          {t("common.backLibrary")}
        </button>
        <div className={cx(ui.eyebrow, "pl-[10px]")}>{t("settings.eyebrow")}</div>
        <h1>{t("common.settings")}</h1>
        <div className="border-t border-border pt-6">
          <div className={cx(ui.eyebrow, "mb-3 pl-[10px]")}>{t("settings.app")}</div>
          <button
            className={ui.settingsNavButton}
            aria-pressed={section === "general"}
            onClick={() => setSection("general")}
          >
            <Languages size={18} />
            {t("settings.general")}
          </button>
          <button
            className={ui.settingsNavButton}
            aria-pressed={section === "extensions"}
            onClick={() => setSection("extensions")}
          >
            <Settings2 size={18} />
            {t("extensions.title")}
          </button>
          {pluginViews.map((view) => (
            <button
              key={view.declaration.id}
              className={ui.settingsNavButton}
              aria-pressed={section === view.declaration.id}
              onClick={() => setSection(view.declaration.id)}
            >
              <Settings2 size={18} />
              {label(view.declaration.title, i18n.resolvedLanguage)}
            </button>
          ))}
          <button
            className={ui.settingsNavButton}
            aria-pressed={section === "providers"}
            onClick={() => setSection("providers")}
          >
            <Layers3 size={18} />
            {t("settings.providers")}
          </button>
          <button
            className={ui.settingsNavButton}
            aria-pressed={section === "ocr"}
            onClick={() => setSection("ocr")}
          >
            <Database size={18} />
            {t("ocr.title")}
          </button>
          <button
            className={ui.settingsNavButton}
            aria-pressed={section === "cache"}
            onClick={() => setSection("cache")}
          >
            <HardDrive size={18} />
            {t("cache.title")}
          </button>
        </div>
      </aside>
      {section === "general" ? (
        <main
          data-ui="settings-main"
          className="min-w-0 flex-1 overflow-y-auto px-[max(30px,calc((100vw_-_1160px)/2))] pt-[52px] pb-[50px] max-desktop:px-[28px] max-desktop:py-[44px]"
        >
          <div className={ui.eyebrowBlue}>{t("settings.generalEyebrow")}</div>
          <h1 className="mt-3 mb-2 text-[27px]">{t("settings.generalTitle")}</h1>
          <p className="mb-[33px] text-[12px] text-muted">{t("settings.generalDescription")}</p>
          <section className={cx(ui.surface, "max-w-[640px] p-6")}>
            <label htmlFor="ui-language" className="mb-3 block text-[12px] font-bold">
              {t("settings.language")}
            </label>
            <select
              id="ui-language"
              className={cx(ui.fieldInput, "max-w-[300px]")}
              disabled={languageBusy}
              value={i18n.resolvedLanguage === "en" ? "en" : "zh"}
              onChange={(event) => void setLanguage(event.target.value as UiLanguage)}
            >
              <option value="zh" lang="zh-CN">
                简体中文
              </option>
              <option value="en" lang="en">
                English
              </option>
            </select>
            <p className="mt-4 mb-0 text-[11px] leading-[1.8] text-muted">
              {t("settings.languageHint")}
            </p>
          </section>
        </main>
      ) : section === "extensions" ? (
        <ExtensionSettings />
      ) : section === "ocr" ? (
        <OcrSettings
          providers={providers}
          activeProviderId={activeProviderId}
          onProvidersChange={onProvidersChange}
          onActiveProviderChange={onActiveProviderChange}
          onError={onError}
        />
      ) : section === "cache" ? (
        <CacheSettings />
      ) : null}
      {pluginViews.map((view) => (
        <div
          key={`${view.declaration.id}:${view.instance}`}
          className={section === view.declaration.id ? "flex min-w-0 flex-1" : "hidden"}
        >
          <ExtensionView view={view} />
        </div>
      ))}
      <div className={section === "providers" ? "flex min-w-0 flex-1" : "hidden"}>
        <ProviderEditor
          purpose="llm"
          providers={providers}
          activeProviderId={activeProviderId}
          onProvidersChange={onProvidersChange}
          onActiveProviderChange={onActiveProviderChange}
          onError={onError}
        />
      </div>
    </div>
  );
}
