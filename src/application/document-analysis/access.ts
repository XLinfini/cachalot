import type { DocumentRecord } from "../../domain/records";
import type { DocumentHandle, DocumentSnapshot } from "../../domain/document-workbench";
import { DocumentAnalysisSession } from "./session";
import {
  validPdfResourceRef,
  type PdfResource,
  type PdfResourceRef,
} from "../../domain/pdf-resources";

/** Explicit ownership for jobs; never borrows the current reader's disposable session. */
export async function openDocumentHandle(
  documentId: string,
  ports: {
    list(): Promise<DocumentRecord[]>;
    loadPdf(id: string): Promise<Uint8Array>;
    createSession?: (document: DocumentRecord, bytes: Uint8Array) => DocumentAnalysisSession;
    resolveResource?: (
      bytes: Uint8Array,
      ref: PdfResourceRef,
      signal?: AbortSignal,
    ) => Promise<PdfResource>;
  },
  signal?: AbortSignal,
): Promise<DocumentHandle> {
  signal?.throwIfAborted();
  const document = (await ports.list()).find((item) => item.id === documentId);
  if (!document) throw new Error("Document not found");
  let bytes = await ports.loadPdf(documentId);
  signal?.throwIfAborted();
  let session: DocumentAnalysisSession | undefined =
    ports.createSession?.(document, bytes) ??
    new DocumentAnalysisSession(
      document,
      bytes,
      () => undefined,
      () => undefined,
    );
  const lifetime = new AbortController();
  const close = () => {
    if (lifetime.signal.aborted) return;
    lifetime.abort();
    session?.dispose();
    session = undefined;
    bytes = new Uint8Array(0);
  };
  const check = () => {
    lifetime.signal.throwIfAborted();
  };
  const read = async <T>(operation: (session: DocumentAnalysisSession) => Promise<T>) => {
    check();
    const result = await operation(session!);
    check();
    return structuredClone(result);
  };
  return {
    document: structuredClone(document),
    readPdf: async (signal) => {
      check();
      signal?.throwIfAborted();
      return bytes.slice();
    },
    async readResource(ref, signal) {
      check();
      const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
      combined.throwIfAborted();
      if (
        !validPdfResourceRef(ref) ||
        ref.documentId !== document.id ||
        ref.page > document.pageCount
      )
        throw new Error("PDF resource source mismatch");
      if (!ports.resolveResource) throw new Error("PDF resource resolver unavailable");
      const result = await ports.resolveResource(bytes, structuredClone(ref), combined);
      combined.throwIfAborted();
      return structuredClone(result);
    },
    getPageFacts: (page) => read((session) => session.getPageFacts(page)),
    getLayoutObservations: (page) => read((session) => session.getLayoutObservations(page)),
    getSemanticPage: (page) => read((session) => session.getSemanticPage(page)),
    getDocumentSemantics: () => read((session) => session.getDocumentSemantics()),
    async analyze(options = {}) {
      check();
      const current = session!;
      const level = options.level ?? "layout";
      if (level !== "facts" && level !== "layout") throw new Error("Invalid analysis level");
      const combined = AbortSignal.any([
        lifetime.signal,
        ...(options.signal ? [options.signal] : []),
      ]);
      // A cancelled inference must not leave an expensive worker running. The
      // handle remains closed afterwards; another lease can resume cached pages.
      combined.throwIfAborted();
      combined.addEventListener("abort", close, { once: true });
      try {
        const facts = [];
        for (let page = 1; page <= document.pageCount; page++) {
          combined.throwIfAborted();
          facts.push(await current.getPageFacts(page));
          combined.throwIfAborted();
          await options.onProgress?.({
            phase: "facts",
            completed: page,
            total: document.pageCount,
          });
        }
        if (level === "layout")
          for (let page = 1; page <= document.pageCount; page++) {
            combined.throwIfAborted();
            await current.getSemanticPage(page);
            combined.throwIfAborted();
            await options.onProgress?.({
              phase: "layout",
              completed: page,
              total: document.pageCount,
            });
          }
        const semantics = await current.getDocumentSemantics();
        combined.throwIfAborted();
        if (level === "layout" && !semantics.coverage.complete)
          throw new Error("Incomplete document analysis");
        return structuredClone({ document, level, semantics, facts } satisfies DocumentSnapshot);
      } finally {
        combined.removeEventListener("abort", close);
      }
    },
    async close() {
      close();
    },
  };
}
