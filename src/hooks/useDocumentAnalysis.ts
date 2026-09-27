import { message } from "../domain/messages";
import { useEffect, useRef, useState } from "react";
import { services } from "../application/services";
import type { DocumentAnalysisSession } from "../application/document-analysis";
import type { AnalysisProgress, PageAnalysis } from "../domain/analysis";
import type { DocumentRecord } from "../domain/records";

/** React lifecycle adapter. Parsing and persistence live outside this hook. */
export function useDocumentAnalysis(
  document: DocumentRecord,
  bytes: Uint8Array | null,
  page: number,
) {
  const [pages, setPages] = useState<Map<number, PageAnalysis>>(new Map());
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
    setPages(new Map());
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
      (analysis) => {
        setPages((current) => {
          // A delayed native result must not overwrite an already analyzed page.
          if (
            current.get(analysis.page)?.cacheKey === analysis.cacheKey ||
            !current.has(analysis.page) ||
            !analysis.cacheKey.includes("native")
          )
            return new Map(current).set(analysis.page, analysis);
          return current;
        });
      },
      setProgress,
    );
    session.current = next;
    void next.start(currentPage.current);
    return () => {
      next.dispose();
      if (session.current === next) session.current = null;
    };
  }, [document.id, bytes]);
  return {
    pageAnalysis: pages.get(page) || null,
    pageAnalyses: pages,
    progress,
    retry: () => {
      if (session.current) void session.current.start(page);
    },
    getPage: async (number: number) => {
      const cached = pages.get(number);
      if (cached && !cached.cacheKey.includes("native")) return cached;
      if (!session.current) throw new Error(message("analysisLoading"));
      return session.current.getPage(number);
    },
  };
}
