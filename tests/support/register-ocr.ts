import { readdir } from "node:fs/promises";
import { ocrAdapters } from "../../src/infrastructure/ocr/registry";
import type { OcrAdapter } from "../../src/domain/ocr-adapter";

/** Node has no Vite import.meta.glob; discover the exact same source directory
 * without a second hand-maintained vendor list. Import in OCR boundary tests. */
const directory = new URL("../../src/infrastructure/ocr/providers/", import.meta.url);
for (const file of (await readdir(directory)).filter((file) => file.endsWith(".ts")).sort()) {
  const module: { default: OcrAdapter } = await import(new URL(file, directory).href);
  ocrAdapters.register(module.default);
}
