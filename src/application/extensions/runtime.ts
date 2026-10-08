/** Composition root. This is the only core module that imports built-in packages. */
import i18n from "i18next";
import { listEnabledModels, resolveEnabledModel, onDidChangeModels } from "../model-catalog";
import { services } from "../services";
import { platform } from "../../infrastructure/platform";
import { reconstructFormulas } from "../ocr";
import type { DocumentAnalysisSession } from "../document-analysis";
import type { DocumentSemantics } from "../../domain/document-semantics";
import { ExtensionHost } from "./host";
import { manifest } from "../../extensions/selection-translation/manifest";
import { message } from "../../domain/messages";
import { Emitter, disposable } from "./events";
import { ExtensionRepository } from "../../infrastructure/extensions/repository";
import { ArtifactRepository } from "../../infrastructure/extensions/artifacts";
import { pdfOperations } from "../../infrastructure/pdf/operations";
import { ExtensionInstaller, packageInstallation } from "./installer";
const extensionRepository = new ExtensionRepository();
const artifactRepository = new ArtifactRepository();

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
    catalog: {
      load: async () => {
        const installed = [];
        for (const pkg of await extensionRepository.list()) {
          try {
            installed.push(packageInstallation(pkg));
          } catch (error) {
            errors.fire(String(error));
          }
        }
        return installed;
      },
      remove: (ids) => extensionRepository.change([], ids),
    },
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
      openDocument: services.analysis.openDocument,
      getPageFacts: async (id, page) => structuredClone(await session(id).getPageFacts(page)),
      getLayoutObservations: async (id, page) =>
        structuredClone(await session(id).getLayoutObservations(page)),
      getSemanticPage: async (id, page) => structuredClone(await session(id).getSemanticPage(page)),
      getDocumentSemantics: async (id) => structuredClone(await session(id).getDocumentSemantics()),
    },
    artifacts: {
      write: (owner, input, signal) => artifactRepository.write(owner, input, signal),
      read: (owner, id, signal) => artifactRepository.read(owner, id, signal),
      list: (owner, id) => artifactRepository.list(owner, id),
      delete: (owner, id) => artifactRepository.delete(owner, id),
      async export(owner, id, signal) {
        signal?.throwIfAborted();
        const artifact = (await artifactRepository.list(owner)).find((item) => item.id === id);
        if (!artifact) throw new Error("Artifact not found");
        const bytes = await artifactRepository.read(owner, id, signal);
        signal?.throwIfAborted();
        const url = URL.createObjectURL(
          new Blob([bytes.slice().buffer], { type: artifact.mediaType }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = artifact.name;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      },
    },
    pdf: pdfOperations,
    typesetting: services.typesetting,
    ocr: {
      reconstructFormulas: (formulas, options) =>
        reconstructFormulas({
          formulas,
          fallback: { provider: options.fallback!, supportsImages: !!options.supportsImages },
          model: options.model,
          signal: options.signal,
        }),
    },
    formulas: services.formulas,
    lm: {
      getModels: listEnabledModels,
      resolveModel: resolveEnabledModel,
      onDidChangeModels,
      supportsImages: services.providers.supportsImages,
      complete: platform.complete,
    },
    revealPage: (documentId, page) => reveals.fire({ documentId, page }),
    showError: (error) => errors.fire(error),
  },
);
export const extensionInstaller = new ExtensionInstaller(extensionHost, extensionRepository);
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
