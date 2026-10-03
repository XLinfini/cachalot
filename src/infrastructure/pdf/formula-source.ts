import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { platform } from "../platform";
import { formulaRepository, type FormulaRecord } from "../formula-repository";
import type { FormulaFragment } from "../../domain/analysis";
import { AnalysisClient } from "../analysis/client";
import { cacheGeneration } from "../cache-writes";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
let queue: Promise<unknown> = Promise.resolve();

/** Lossless, zoom-independent previews. Source PDF plus normalized crop remains
 * canonical; these PNGs are only for browser layout and recognition input. */
export function formulaSources(formulas: FormulaFragment[]): Promise<FormulaRecord[]> {
  const generation = cacheGeneration("formulas");
  const work = queue.then(async () => {
    const records = await Promise.all(
      formulas.map(async (f) => {
        const cached = await formulaRepository.get(f);
        // Reuse image bytes/candidates, but never let an old asset erase fresh
        // selection evidence or restore characters outside a clipped selection.
        return cached ? { ...cached, asset: { ...cached.asset, formula: f } } : null;
      }),
    );
    const missing = formulas.filter((_, i) => !records[i]);
    if (!missing.length) return records as FormulaRecord[];
    const task = pdfjs.getDocument({ data: await platform.loadPdf(missing[0].documentId) });
    try {
      const pdf = await task.promise;
      for (let i = 0; i < formulas.length; i++) {
        if (records[i]) continue;
        const formula = formulas[i],
          page = await pdf.getPage(formula.page);
        const base = page.getViewport({ scale: 1 });
        const w = (formula.box[2] - formula.box[0]) * base.width;
        const h = (formula.box[3] - formula.box[1]) * base.height;
        const scale = Math.min(4, Math.sqrt(4000000 / Math.max(1, w * h)));
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(w * scale));
        canvas.height = Math.max(1, Math.ceil(h * scale));
        try {
          await page.render({
            canvas,
            viewport,
            transform: [
              1,
              0,
              0,
              1,
              -formula.box[0] * viewport.width,
              -formula.box[1] * viewport.height,
            ],
            background: "white",
          }).promise;
          const record: FormulaRecord = {
            documentId: formula.documentId,
            id: formula.id,
            candidates: {},
            asset: {
              formula,
              imageDataUrl: canvas.toDataURL("image/png"),
              width: canvas.width,
              height: canvas.height,
              scale,
            },
          };
          await formulaRepository.put(record, generation);
          records[i] = record;
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      return records as FormulaRecord[];
    } finally {
      await task.destroy();
    }
  });
  queue = work.catch(() => undefined);
  return work;
}

/** Future PDF reflow/export uses this vector-preserving crop, never PNG or
 * re-typeset OCR. Each exported region still references original resources. */
export async function exportFormulaPdf(formula: FormulaFragment): Promise<Uint8Array> {
  const client = new AnalysisClient(() => undefined);
  try {
    await client.open(formula.documentId, await platform.loadPdf(formula.documentId));
    return await client.exportRegion(formula.page, formula.box);
  } finally {
    client.dispose();
  }
}
