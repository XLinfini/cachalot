import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { services } from "../application/services";
import { en } from "./locales/en";
import { zh } from "./locales/zh";

export type UiLanguage = "zh" | "en";
export const LANGUAGE_SETTING = "uiLanguage";
export const resources = { en: { translation: en }, zh: { translation: zh } };
export const dateLocale = () => (i18n.resolvedLanguage === "en" ? "en-US" : "zh-CN");

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}

// Both dictionaries ship with the app. No network request or key is needed.
export async function initializeI18n(): Promise<void> {
  const saved = await services.settings.get(LANGUAGE_SETTING).catch(() => null);
  await i18n.use(initReactI18next).init({
    resources,
    lng: saved === "en" ? "en" : "zh",
    fallbackLng: "zh",
    supportedLngs: ["zh", "en"],
    interpolation: { escapeValue: false }, // React escapes rendered strings.
  });
  document.documentElement.lang = dateLocale();
  i18n.on("languageChanged", () => {
    document.documentElement.lang = dateLocale();
  });
}

// Persist first: a failed settings write leaves the current language intact.
// Settings UI disables the control while saving, so requests cannot race.
export async function changeUiLanguage(language: UiLanguage): Promise<void> {
  await services.settings.set(LANGUAGE_SETTING, language);
  await i18n.changeLanguage(language);
}
export default i18n;
