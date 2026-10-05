import { en as coreEn } from "../../src/i18n/locales/en";
import { zh as coreZh } from "../../src/i18n/locales/zh";
import { locales } from "../../src/extensions/selection-translation/locales";
export const en = {
  ...coreEn,
  translation: locales.en.translation,
  settings: { ...coreEn.settings, ...locales.en.settings },
  reader: { ...coreEn.reader, ...locales.en.reader },
};
export const zh = {
  ...coreZh,
  translation: locales.zh.translation,
  settings: { ...coreZh.settings, ...locales.zh.settings },
  reader: { ...coreZh.reader, ...locales.zh.reader },
};

export type LocaleResource = { [K in keyof typeof en]: Widen<(typeof en)[K]> };
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
