/** Language-neutral messages can cross Worker/SQLite boundaries. The UI alone
 * resolves them to prose; changing UI language never invalidates PDF caches. */
export const MESSAGE_CODES = [
  "loadingPaper",
  "loadingCache",
  "loadingModel",
  "analyzingPage",
  "analyzingLayout",
  "analysisSaved",
  "analysisStopped",
  "analysisLoading",
  "analysisEngineError",
  "cacheWriteFailed",
  "cacheBlocked",
  "ocrAdapterUnavailable",
  "ocrRequestInvalid",
  "pdfMemory",
  "pdfOpen",
  "pdfNotOpen",
  "pdfPage",
  "pdfText",
  "pdfCoordinates",
  "pdfBitmap",
  "modelUnavailable",
  "modelIncomplete",
  "modelChecksum",
  "pdfEngineUnavailable",
  "modelInterface",
  "modelImage",
  "noNativeText",
  "unassignedCharacters",
  "unmappedCharacters",
  "pdfOnly",
  "fileTooLarge",
  "pdfNotFound",
  "categoryNameRequired",
  "categoryNameTooLong",
  "categoryNameReserved",
  "categoryNameDuplicate",
  "categoryNotFound",
  "providerNotFound",
  "browserKeyReadFailed",
  "browserKeySaveFailed",
  "invalidApiUrl",
  "modelsHttp",
  "modelsHttpDetails",
  "completionHttp",
  "completionHttpDetails",
  "completionStreamError",
  "ocrHttp",
  "ocrHttpDetails",
  "ocrResponseError",
  "ocrImageInvalid",
  "configureOcr",
  "ocrTestFailed",
  "connectionSucceeded",
  "configureProvider",
  "configureModel",
  "configureTranslation",
  "visionRequired",
  "emptyResponse",
  "providerDraft",
  "providerSaved",
  "promptSaved",
  "languageSaveFailed",
  "singlePageSelection",
  "imageUnsupported",
  "imageFileInvalid",
  "imageFileTooLarge",
  "formulaSourceFailed",
  "formulaReferencesChanged",
  "headingReferencesChanged",
] as const;
export type MessageCode = (typeof MESSAGE_CODES)[number];
export type MessageValues = Record<string, string | number>;
export interface MessageDescriptor {
  code: MessageCode;
  values: MessageValues;
}
const PREFIX = "cachalot-message:";

export function message(code: MessageCode, values: MessageValues = {}): string {
  return PREFIX + JSON.stringify({ code, values });
}
export function parseMessage(value: string): MessageDescriptor | null {
  const encoded = value.replace(/^Error:\s*/, "");
  if (!encoded.startsWith(PREFIX)) return null;
  try {
    const parsed = JSON.parse(encoded.slice(PREFIX.length));
    if (
      !MESSAGE_CODES.includes(parsed.code) ||
      !parsed.values ||
      typeof parsed.values !== "object" ||
      !Object.values(parsed.values).every((v) => typeof v === "string" || typeof v === "number")
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
