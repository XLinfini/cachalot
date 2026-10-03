import type { OcrAdapter } from "../../domain/ocr-adapter";
import { ocrAdapters } from "./registry";

// Vite discovers additions to this directory in dev and production builds.
// This is the only bootstrap; no vendor imports or switch statements in core.
const modules = import.meta.glob<OcrAdapter>("./providers/*.ts", {
  eager: true,
  import: "default",
});
for (const path of Object.keys(modules).sort()) ocrAdapters.register(modules[path]);
