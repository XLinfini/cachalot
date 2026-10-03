import { platform } from "../infrastructure/platform";
import { analysisRepository } from "../infrastructure/analysis/repository";
import { DocumentAnalysisSession } from "./document-analysis";
import { askPaper, translateRegion } from "./paper-assistant";
import { importPaper } from "./import-paper";
import {
  listConfiguredProviders,
  saveConfiguredProvider,
  listModels,
  supportsImages,
} from "./model-catalog";
import { documentPreview, removePreview } from "../infrastructure/pdf/document-preview";
import { formulaRepository } from "../infrastructure/formula-repository";
import { exportFormulaPdf } from "../infrastructure/pdf/formula-source";
import { getOcrSelection, saveOcrSelection, testOcrProvider } from "./ocr-settings";
import { cacheManagement } from "./cache-management";
import { listOcrAdapters, listOcrPresets, ocrRequestEndpoint, createOcrPreset } from "./ocr-catalog";

/**
 * Public facade for presentation code. UI replacements depend on these methods
 * and domain DTOs, never on Tauri commands, SQL, IndexedDB or model tensors.
 */
export const services = {
  cache: cacheManagement,
  library: {
    list: platform.listDocuments,
    importPaper,
    loadPdf: platform.loadPdf,
    preview: documentPreview,
    setProgress: platform.setProgress,
    setStarred: platform.setStarred,
    move: platform.moveDocument,
    async remove(id: string): Promise<void> {
      await platform.deleteDocument(id);
      await analysisRepository.deleteDocument(id);
      await removePreview(id);
      await formulaRepository.removeDocument(id);
    },
  },
  categories: {
    list: platform.listCategories,
    create: platform.createCategory,
    remove: platform.deleteCategory,
  },
  settings: { get: platform.getSetting, set: platform.setSetting },
  ocr: { getSelection: getOcrSelection, select: saveOcrSelection, test: testOcrProvider, adapters: listOcrAdapters, presets: listOcrPresets, endpoint: ocrRequestEndpoint, createPreset: createOcrPreset },
  providers: {
    list: listConfiguredProviders,
    save: saveConfiguredProvider,
    remove: platform.deleteProvider,
    listModels,
    supportsImages,
    keyPreview: platform.providerKeyPreview,
    revealKey: platform.revealProviderKey,
    // Preserve the adapter receiver; testProvider delegates to this.listModels.
    test: (id: string) => platform.testProvider(id),
  },
  conversations: {
    create: platform.createThread,
    list: platform.listThreads,
    rename: platform.renameThread,
    remove: platform.deleteThread,
    messages: platform.listMessages,
    saveMessage: platform.saveMessage,
    removeMessage: platform.deleteMessage,
  },
  analysis: {
    createSession: (...args: ConstructorParameters<typeof DocumentAnalysisSession>) =>
      new DocumentAnalysisSession(...args),
  },
  assistant: { askPaper, translateRegion },
  formulas: { exportPdf: exportFormulaPdf },
};
