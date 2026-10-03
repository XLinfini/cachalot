import type { OcrContext } from "../../domain/ocr-adapter";
import type { Provider } from "../../domain/records";
import { platform } from "../platform";

/** Every adapter uses these primitives on browser and Tauri alike. */
export function ocrContext(provider: Provider): OcrContext {
  return {
    baseUrl: provider.baseUrl,
    modelId: provider.modelId,
    transport: {
      json: (request) => platform.ocrJson({ ...request, providerId: provider.id }),
      models: () => platform.listModels(provider.id),
      async complete(input) {
        let output = "";
        await platform.complete(
          { ...input, providerId: provider.id, modelId: provider.modelId },
          (delta) => {
            output += delta;
          },
        );
        return output;
      },
    },
  };
}
