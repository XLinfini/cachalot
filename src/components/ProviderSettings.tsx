import { useEffect, useState } from "react";
import {
  ChevronRight,
  Database,
  HardDrive,
  Layers3,
  Languages,
  Search,
  Settings2,
  X,
} from "lucide-react";
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
  onError: (message: string) => void;
}

export default function ProviderSettings({
  providers,
  activeProviderId,
  onProvidersChange,
  onActiveProviderChange,
  onError,
}: Props) {
  const { t, i18n } = useTranslation();
  const [languageBusy, setLanguageBusy] = useState(false);
  const [query, setQuery] = useState("");
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

  const entries = [
    {
      id: "general",
      title: t("settings.general"),
      icon: Languages,
      group: "app",
      keywords: [t("settings.language"), "English", "简体中文"],
    },
    {
      id: "providers",
      title: t("settings.providers"),
      icon: Layers3,
      group: "app",
      keywords: [
        t("settings.provider"),
        t("settings.apiUrl"),
        t("settings.apiKey"),
        t("settings.modelId"),
        t("settings.vision"),
      ],
    },
    {
      id: "ocr",
      title: t("ocr.title"),
      icon: Database,
      group: "app",
      keywords: [t("ocr.mode"), t("ocr.profile"), t("ocr.providersTitle")],
    },
    {
      id: "cache",
      title: t("cache.title"),
      icon: HardDrive,
      group: "app",
      keywords: [
        t("cache.eyebrow"),
        ...Object.values(t("cache.kinds", { returnObjects: true })).map((kind) => kind.name),
      ],
    },
    {
      id: "extensions",
      title: t("extensions.title"),
      icon: Settings2,
      group: "extensions",
      keywords: [t("extensions.installPackage"), t("extensions.restartAll")],
    },
    ...pluginViews.map((view) => ({
      id: view.declaration.id,
      title: label(view.declaration.title, i18n.resolvedLanguage),
      icon: Settings2,
      group: "extensions",
      keywords: [] as string[],
    })),
  ];
  const matchingEntries = (value: string) => {
    const words = value.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/);
    return entries.filter((entry) => {
      const text = [entry.title, ...entry.keywords].join(" ").normalize("NFKC").toLocaleLowerCase();
      return words.every((word) => text.includes(word));
    });
  };
  const matches = matchingEntries(query);
  const activeTitle = entries.find((entry) => entry.id === section)?.title;
  const changeQuery = (value: string) => {
    setQuery(value);
    const next = matchingEntries(value);
    if (next.length && !next.some((entry) => entry.id === section)) setSection(next[0].id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="flex flex-none items-center gap-4 border-b border-border px-6 py-4">
        <label className="flex h-[38px] min-w-0 flex-1 items-center gap-2.5 rounded-md border border-[#dce5ef] bg-white px-3 text-muted focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/10">
          <Search size={17} className="flex-none" aria-hidden="true" />
          <input
            data-ui="settings-search"
            type="search"
            aria-label={t("settings.search")}
            placeholder={t("settings.searchPlaceholder")}
            className="min-w-0 flex-1 border-0 bg-transparent text-[12px] text-ink outline-none placeholder:text-subtle focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                changeQuery("");
              }
            }}
          />
          {query && (
            <button
              type="button"
              className={ui.iconButton}
              aria-label={t("settings.clearSearch")}
              onClick={() => changeQuery("")}
            >
              <X size={14} />
            </button>
          )}
        </label>
        <span role="status" className="flex-none text-[11px] text-muted">
          {t("settings.categoryCount", { count: matches.length })}
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[208px] flex-none overflow-y-auto border-r border-border bg-canvas px-3 py-5 max-compact:w-[176px]">
          <nav aria-label={t("settings.categories")}>
            {["app", "extensions"].map((group) => {
              const items = matches.filter((entry) => entry.group === group);
              return items.length ? (
                <div key={group} className="mb-5">
                  <div className="mb-2 px-3 text-[10px] font-semibold tracking-wide text-muted">
                    {t(group === "app" ? "settings.app" : "settings.extensionGroup")}
                  </div>
                  {items.map(({ id, title, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      className={ui.settingsNavButton}
                      aria-pressed={section === id}
                      onClick={() => setSection(id)}
                      title={title}
                    >
                      <Icon size={16} className="flex-none" aria-hidden="true" />
                      <span className="min-w-0 truncate">{title}</span>
                    </button>
                  ))}
                </div>
              ) : null;
            })}
          </nav>
        </aside>
        {!matches.length && (
          <div
            data-ui="settings-no-results"
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-8 text-center"
          >
            <Search size={28} className="text-subtle" aria-hidden="true" />
            <h2 className="m-0 text-[16px]">{t("settings.noResults")}</h2>
            <p className="m-0 text-[12px] text-muted">{t("settings.searchHint")}</p>
            <button type="button" className={ui.secondaryButton} onClick={() => changeQuery("")}>
              {t("settings.clearSearch")}
            </button>
          </div>
        )}
        {matches.length > 0 && section === "general" ? (
          <main data-ui="settings-main" className={ui.settingsPage}>
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
        ) : matches.length > 0 && section === "extensions" ? (
          <ExtensionSettings />
        ) : matches.length > 0 && section === "ocr" ? (
          <OcrSettings
            providers={providers}
            activeProviderId={activeProviderId}
            onProvidersChange={onProvidersChange}
            onActiveProviderChange={onActiveProviderChange}
            onError={onError}
          />
        ) : matches.length > 0 && section === "cache" ? (
          <CacheSettings />
        ) : null}
        {pluginViews.map((view) => (
          <div
            key={`${view.declaration.id}:${view.instance}`}
            className={
              matches.length && section === view.declaration.id ? "flex min-w-0 flex-1" : "hidden"
            }
          >
            <ExtensionView view={view} />
          </div>
        ))}
        <div
          className={matches.length && section === "providers" ? "flex min-w-0 flex-1" : "hidden"}
        >
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
      <footer className="flex h-[36px] flex-none items-center justify-between gap-3 border-t border-border bg-canvas px-5 text-[10px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          {t("common.settings")}
          <ChevronRight size={12} aria-hidden="true" />
          <span className="truncate text-[#607590]">{activeTitle}</span>
        </span>
        <span className="flex flex-none items-center gap-2">
          <kbd className="rounded border border-[#dce5ef] bg-white px-1.5 py-0.5 font-sans text-[9px]">
            Esc
          </kbd>
          {t("settings.closeHint")}
        </span>
      </footer>
    </div>
  );
}
