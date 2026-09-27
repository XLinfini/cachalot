import { message } from "../domain/messages";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { DocumentRecord } from "../domain/records";
import { platform } from "../infrastructure/platform";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** PDF.js reads catalog metadata for the viewer; PDFium owns content analysis. */
export async function importPaper(file: File): Promise<DocumentRecord> {
  if (!file.name.toLowerCase().endsWith(".pdf")) throw new Error(message("pdfOnly", { file: file.name }));
  if (file.size > 200 * 1024 * 1024) throw new Error(message("fileTooLarge", { file: file.name }));
  const bytes = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise;
    const metadata = await pdf.getMetadata().catch(() => null);
    const title = (metadata?.info as { Title?: string } | undefined)?.Title || file.name.replace(/\.pdf$/i, "");
    return await platform.importPdf(file, bytes, pdf.numPages, title);
  } finally { await task.destroy(); }
}
