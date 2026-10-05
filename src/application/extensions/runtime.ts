/** Composition root. This is the only core module that imports built-in packages. */
import i18n from "i18next";
import { services } from "../services";
import { platform } from "../../infrastructure/platform";
import { reconstructFormulas } from "../ocr";
import type { DocumentAnalysisSession } from "../document-analysis";
import type { DocumentSemantics } from "../../domain/document-semantics";
import { ExtensionHost } from "./host";
import { manifest } from "../../extensions/selection-translation/manifest";
import { message } from "../../domain/messages";
import { Emitter, disposable } from "./events";

let documentSession: { documentId: string; session: DocumentAnalysisSession } | undefined;
const errors = new Emitter<string>();
const reveals = new Emitter<{ documentId: string; page: number }>();
function session(id: string) {
  if (documentSession?.documentId !== id) throw new Error(message("analysisLoading"));
  return documentSession.session;
}
export const extensionHost = new ExtensionHost(
  [
    {
      manifest,
      builtIn: true,
      configurationMigrations: { prompt: "translationPrompt" },
      load: () => import("../../extensions/selection-translation/extension"),
    },
  ],
  {
    localization: {
      language: () => (i18n.resolvedLanguage === "en" ? "en" : "zh"),
      onDidChangeLanguage: (listener) => {
        const changed = () => listener(i18n.resolvedLanguage === "en" ? "en" : "zh");
        i18n.on("languageChanged", changed);
        return disposable(() => i18n.off("languageChanged", changed));
      },
      register: (id, resources) => {
        for (const language of ["zh", "en"] as const)
          i18n.addResourceBundle(language, id, resources[language], true, true);
        return disposable(() => {
          for (const language of ["zh", "en"]) i18n.removeResourceBundle(language, id);
        });
      },
      translate: (id, key, values) =>
        String(
          i18n.t(key as never, {
            ...values,
            ns: i18n.exists(key, { ns: id as "translation" }) ? id : "translation",
          }),
        ),
    },
    getSetting: services.settings.get,
    setSetting: services.settings.set,
    documents: {
      getPageFacts: async (id, page) => structuredClone(await session(id).getPageFacts(page)),
      getLayoutObservations: async (id, page) =>
        structuredClone(await session(id).getLayoutObservations(page)),
      getSemanticPage: async (id, page) => structuredClone(await session(id).getSemanticPage(page)),
      getDocumentSemantics: async (id) => structuredClone(await session(id).getDocumentSemantics()),
    },
    ocr: {
      reconstructFormulas: (formulas, options) =>
        reconstructFormulas({
          formulas,
          fallback: { provider: options.fallback, supportsImages: options.supportsImages },
          signal: options.signal,
        }),
    },
    formulas: services.formulas,
    lm: { supportsImages: services.providers.supportsImages, complete: platform.complete },
    revealPage: (documentId, page) => reveals.fire({ documentId, page }),
    showError: (error) => errors.fire(error),
  },
);
export const onExtensionError = errors.event;
export const onRevealPage = reveals.event;
export function bindDocumentSession(documentId: string, current: DocumentAnalysisSession) {
  const bound = { documentId, session: current };
  documentSession = bound;
  return disposable(() => {
    if (documentSession === bound) documentSession = undefined;
  });
}
export function publishDocumentSemantics(documentId: string, semantics: DocumentSemantics) {
  extensionHost.publishDocument(documentId, structuredClone(semantics));
}
