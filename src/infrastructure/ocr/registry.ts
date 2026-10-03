import type { OcrAdapter } from "../../domain/ocr-adapter";
import { message } from "../../domain/messages";

export class OcrAdapterRegistry {
  private adapters = new Map<string, OcrAdapter>();
  register(adapter: OcrAdapter): void {
    if (
      !/^[a-z][a-z0-9-]*$/.test(adapter.id) ||
      !Number.isInteger(adapter.batchSize) ||
      adapter.batchSize < 1 ||
      !adapter.cachePrefix ||
      !adapter.label.zh ||
      !adapter.label.en ||
      typeof adapter.endpoint !== "function" ||
      typeof adapter.recognize !== "function"
    )
      throw new Error(`Invalid OCR adapter: ${adapter.id}`);
    if (this.adapters.has(adapter.id)) throw new Error(`Duplicate OCR adapter: ${adapter.id}`);
    const presetIds = new Set(
      this.list().flatMap((item) => (item.presets || []).map((preset) => preset.id)),
    );
    for (const preset of adapter.presets || []) {
      if (
        !/^[a-z][a-z0-9-]*$/.test(preset.id) ||
        !preset.name ||
        !preset.baseUrl ||
        !preset.buttonLabel.zh ||
        !preset.buttonLabel.en ||
        !preset.models.length
      )
        throw new Error(`Invalid OCR preset: ${preset.id}`);
      if (presetIds.has(preset.id)) throw new Error(`Duplicate OCR preset: ${preset.id}`);
      presetIds.add(preset.id);
    }
    this.adapters.set(adapter.id, adapter);
  }
  get(id: string): OcrAdapter | undefined {
    return this.adapters.get(id);
  }
  require(id: string): OcrAdapter {
    const adapter = this.get(id);
    if (!adapter) throw new Error(message("ocrAdapterUnavailable", { adapter: id }));
    return adapter;
  }
  list(): OcrAdapter[] {
    return [...this.adapters.values()].sort(
      (a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id),
    );
  }
}
export const ocrAdapters = new OcrAdapterRegistry();
