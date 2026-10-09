import { PdfiumDocument } from "../analysis/pdfium";
import { validBox } from "../../domain/pdf-comparison";
import type { PdfOperation } from "./operations";

self.onmessage = async (event: MessageEvent<{ wasmUrl: string; operation: PdfOperation }>) => {
  let pdf: PdfiumDocument | undefined;
  try {
    const response = await fetch(event.data.wasmUrl);
    if (!response.ok) throw new Error("PDF engine unavailable");
    pdf = await PdfiumDocument.create(await response.arrayBuffer());
    const input = event.data.operation;
    let value: unknown;
    if (input.kind === "compose") value = await pdf.compose(input.input);
    else {
      if (
        !(input.bytes instanceof Uint8Array) ||
        !input.bytes.length ||
        input.bytes.length > 256 * 1024 * 1024
      )
        throw new Error("Invalid PDF bytes");
      const count = pdf.open(input.bytes);
      if (input.kind === "inspect") value = pdf.inspectPages();
      else if (input.kind === "resource") value = await pdf.resolveResource(input.ref);
      else {
        if (
          !Number.isInteger(input.page) ||
          input.page < 1 ||
          input.page > count ||
          !validBox(input.box)
        )
          throw new Error("Invalid PDF region");
        const bytes = pdf.exportRegion(input.page, input.box);
        pdf.open(bytes);
        const size = pdf.inspectPages()[0];
        value = { bytes, width: size.width, height: size.height, contentIsolation: "visual-crop" };
      }
    }
    self.postMessage({ value });
  } catch (error) {
    self.postMessage({ error: String(error) });
  } finally {
    pdf?.close();
  }
};
