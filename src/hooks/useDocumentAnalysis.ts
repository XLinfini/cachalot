import { message } from "../domain/messages";
import { useEffect, useRef, useState } from "react";
import { bindDocumentSession, publishDocumentSemantics } from "../application/extensions/runtime";
import { services } from "../application/services";
import type { DocumentAnalysisSession } from "../application/document-analysis";
import type { AnalysisProgress } from "../domain/analysis";
import type { AnalysisSnapshot, SemanticPageView } from "../domain/document-semantics";
import type { DocumentRecord } from "../domain/records";

/** React lifecycle adapter. Parsing and persistence live outside this hook. */
export function useDocumentAnalysis(
  document: DocumentRecord,
  bytes: Uint8Array | null,
  page: number,
) {
  const [snapshot, setSnapshot] = useState<AnalysisSnapshot | null>(null);
  const [progress, setProgress] = useState<AnalysisProgress>({
    phase: "loading",
    completed: 0,
    total: document.pageCount,
    message: message("loadingPaper"),
  });
  const session = useRef<DocumentAnalysisSession | null>(null);
  const currentPage = useRef(page);
  currentPage.current = page;
  useEffect(() => {
    setSnapshot(null);
    setProgress({
      phase: "loading",
      completed: 0,
      total: document.pageCount,
      message: message("loadingPaper"),
    });
    if (!bytes) return;
    const next = services.analysis.createSession(
      document,
      bytes,
      (next) => {
        publishDocumentSemantics(document.id, next.semantics);
        setSnapshot((current) =>
          !current || next.semantics.revision >= current.semantics.revision ? next : current,
        );
      },
      setProgress,
    );
    session.current = next;
    const binding = bindDocumentSession(document.id, next);
    void next.start(currentPage.current);
    return () => {
      binding.dispose();
      next.dispose();
      if (session.current === next) session.current = null;
    };
  }, [document.id, bytes]);
  return {
    documentSemantics: snapshot?.semantics || null,
    semanticPage: snapshot?.pages.find((view) => view.page === page) || null,
    semanticPages: new Map<number, SemanticPageView>(
      snapshot?.pages.map((view) => [view.page, view]),
    ),
    progress,
    retry: () => {
      if (session.current) void session.current.start(page);
    },
    getSemanticPage: async (number: number) => {
      if (!session.current) throw new Error(message("analysisLoading"));
      return session.current.getSemanticPage(number);
    },
  };
}
