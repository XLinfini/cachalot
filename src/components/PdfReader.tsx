import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Layers3,
  ArrowRight,
  TextCursor,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import type { RefProxy } from "pdfjs-dist/types/src/display/api";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extensionHost, onRevealPage } from "../application/extensions/runtime";
import { ExtensionToolbar, label, useExtensions } from "./extensions/ExtensionWorkbench";
import { services } from "../application/services";
import type { ReaderSelection } from "../domain/reader";
import type { DocumentRecord } from "../domain/records";
import { useDocumentAnalysis } from "../hooks/useDocumentAnalysis";
import { cx, ui } from "../sdk/ui/styles";
import { useTranslation } from "react-i18next";
import { localizeMessage } from "../i18n/messages";
import { PdfPageView } from "./pdf/PdfPageView";
import {
  captureScrollAnchor,
  pageAtOffset,
  pagePositions,
  PAGE_PADDING,
  readingAnchor,
  restoreScrollAnchor,
  type PageSize,
  type ScrollAnchor,
} from "./pdf/page-layout";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_ZOOM = 5;

interface OutlineItem {
  title: string;
  dest?: unknown;
  items?: OutlineItem[];
}

interface ReaderProps {
  comparisonMode?: boolean;
  document: DocumentRecord;
  page: number;
  onPageChange: (page: number) => void;
  onSelection: (selection: ReaderSelection | null, owner?: string) => void;
  selection: ReaderSelection | null;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}

function Thumbnail({
  pdf,
  number,
  active,
  onClick,
}: {
  pdf: pdfjs.PDFDocumentProxy;
  number: number;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!hostRef.current || visible) return;
    if (!window.IntersectionObserver) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    void pdf
      .getPage(number)
      .then((pdfPage) => {
        if (cancelled || !canvasRef.current) return;
        const viewport = pdfPage.getViewport({ scale: 0.16 });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        task = pdfPage.render({ canvas, viewport });
        return task.promise;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, number, visible]);
  return (
    <button
      ref={hostRef}
      data-ui="page-thumbnail"
      data-page={number}
      aria-pressed={active}
      className="flex w-full items-center gap-3 rounded-[7px] border border-transparent bg-transparent p-[7px] text-left text-[10px] text-[#8797aa] hover:border-[#dce9f8] hover:bg-brand-soft hover:text-[#2467c2] aria-pressed:border-[#dce9f8] aria-pressed:bg-brand-soft aria-pressed:text-[#2467c2]"
      onClick={onClick}
      title={t("reader.page", { page: number })}
    >
      <canvas
        className="max-h-[60px] w-[42px] border border-[#e6ebf1] bg-white object-contain shadow-[0_2px_5px_#00000012]"
        ref={canvasRef}
      />
      <span>{number}</span>
    </button>
  );
}

export default function PdfReader({
  comparisonMode = false,
  document,
  page,
  onPageChange,
  onSelection,
  selection,
  sidebarOpen,
  onToggleSidebar,
  chatOpen,
  onToggleChat,
}: ReaderProps) {
  const { t, i18n } = useTranslation();
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [zoom, setZoom] = useState(1);
  const extensions = useExtensions();
  // Until the user chooses a mode, follow the first available tool. Startup
  // activation may finish after the document opens; do not freeze text mode.
  const [chosenMode, setMode] = useState<string | null>(null);
  const mode = chosenMode ?? extensions.tools[0]?.tool.id ?? "text";
  const activeTool = extensions.tools.find((item) => item.tool.id === mode);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [invalidPage, setInvalidPage] = useState(false);
  const pageErrorId = useId();
  const [showLayout, setShowLayout] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [scrollRoot, setScrollRoot] = useState<HTMLDivElement | null>(null);
  const positions = useMemo(() => pagePositions(sizes, zoom), [sizes, zoom]);
  const latestPositions = useRef(positions);
  latestPositions.current = positions;
  const selectionGeneration = useRef(0);
  const reportedPage = useRef(page);
  const navigationTarget = useRef<{ page: number; top: number } | null>(null);
  const initialPositionRestored = useRef(false);
  const zoomAnchor = useRef<ScrollAnchor | null>(null);
  const scrollFrame = useRef<number | null>(null);
  const paneNavigation = useRef(false);
  const { semanticPage, semanticPages, progress, retry, getSemanticPage } = useDocumentAnalysis(
    document,
    bytes,
    page,
  );

  const clearSelection = () => {
    selectionGeneration.current++;
    setSelecting(false);
    setError("");
    onSelection(null);
  };
  useEffect(() => {
    if (mode !== "text" && !activeTool) {
      setMode("text");
      clearSelection();
    }
  }, [mode, activeTool]);
  useEffect(() => {
    const subscription = onRevealPage((target) => {
      if (target.documentId === document.id) jumpToPage(target.page);
    });
    return () => subscription.dispose();
  }, [document.id, positions, scrollRoot]);

  const publishViewState = (number: number) => {
    if (!scrollRoot) return;
    extensionHost.publishReaderState({
      viewId: `reader:${document.id}`,
      documentId: document.id,
      page: number,
      pageCount: document.pageCount,
      zoom,
      scrollTop: scrollRoot.scrollTop,
      viewportHeight: scrollRoot.clientHeight,
      anchor: (() => {
        const anchor = captureScrollAnchor(
          positions,
          scrollRoot.scrollTop,
          scrollRoot.clientHeight,
        );
        return anchor?.page === number ? anchor : { page: number, fraction: 0 };
      })(),
      cause: paneNavigation.current ? "navigation" : "user",
    });
  };
  useEffect(() => {
    if (!scrollRoot || !positions.length) return;
    const subscription = extensionHost.onRevealPane(({ viewId, anchor }) => {
      if (viewId !== `reader:${document.id}`) return;
      paneNavigation.current = true;
      scrollRoot.scrollTo({ top: restoreScrollAnchor(positions, anchor, scrollRoot.clientHeight) });
      navigationTarget.current = { page: anchor.page, top: scrollRoot.scrollTop };
      reportPage(anchor.page);
    });
    return () => subscription.dispose();
  }, [document.id, scrollRoot, positions]);
  useEffect(() => {
    if (!comparisonMode || !scrollRoot || !sizes.length) return;
    const fit = () =>
      setZoom(Math.max(0.2, Math.min(2, (scrollRoot.clientWidth - 70) / (sizes[0].width * 0.96))));
    const observer = new ResizeObserver(fit);
    observer.observe(scrollRoot);
    fit();
    return () => observer.disconnect();
  }, [comparisonMode, scrollRoot, sizes]);
  useEffect(() => {
    publishViewState(page);
    if (!scrollRoot) return;
    const resize = new ResizeObserver(() => publishViewState(reportedPage.current));
    resize.observe(scrollRoot);
    return () => resize.disconnect();
  }, [document.id, page, zoom, scrollRoot, positions, extensions.context["reader.documentId"]]);
  useEffect(
    () => () => {
      if (extensionHost.getSnapshot().context["reader.documentId"] === document.id)
        extensionHost.publishReaderState(null);
    },
    [document.id],
  );

  const reportPage = (number: number) => {
    publishViewState(number);
    if (reportedPage.current === number) return;
    reportedPage.current = number;
    onPageChange(number);
  };
  const jumpToPage = (number: number) => {
    paneNavigation.current = false;
    const target = positions.find((position) => position.number === number);
    if (!target || !scrollRoot) return;
    clearSelection();
    scrollRoot.scrollTo({ top: target.top - PAGE_PADDING });
    // Near the document end, the browser may clamp several page jumps to the
    // same offset. Preserve the requested page until the user scrolls again.
    navigationTarget.current = { page: number, top: scrollRoot.scrollTop };
    reportPage(number);
  };
  const changeZoom = (amount: number) => {
    const nextZoom = Math.min(MAX_ZOOM, Math.max(0.5, Math.round((zoom + amount) * 10) / 10));
    if (nextZoom === zoom) return;
    navigationTarget.current = null;
    if (scrollRoot)
      zoomAnchor.current = captureScrollAnchor(
        positions,
        scrollRoot.scrollTop,
        scrollRoot.clientHeight,
      );
    clearSelection();
    setZoom(nextZoom);
  };
  const handleScroll = () => {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      if (!scrollRoot) return;
      const pages = latestPositions.current;
      const target = navigationTarget.current;
      if (target && Math.abs(target.top - scrollRoot.scrollTop) < 1) {
        reportPage(target.page);
        return;
      }
      navigationTarget.current = null;
      // A short final page may share the viewport with its predecessor. At the
      // document bottom, navigation should still report that final page.
      const atBottom =
        scrollRoot.scrollTop > 0 &&
        scrollRoot.scrollTop + scrollRoot.clientHeight >= scrollRoot.scrollHeight - 1;
      const visible = atBottom
        ? pages.at(-1)
        : pageAtOffset(pages, scrollRoot.scrollTop + readingAnchor(scrollRoot.clientHeight));
      if (visible) reportPage(visible.number);
    });
  };

  // A passive page update must not scroll back to the top of that page. Explicit
  // navigation and zoom restoration use the same measured page geometry.
  useLayoutEffect(() => {
    if (!scrollRoot || !positions.length) return;
    if (zoomAnchor.current) {
      scrollRoot.scrollTop = restoreScrollAnchor(
        positions,
        zoomAnchor.current,
        scrollRoot.clientHeight,
      );
      zoomAnchor.current = null;
    } else if (!initialPositionRestored.current || page !== reportedPage.current) {
      const target = positions.find((position) => position.number === page) || positions[0];
      scrollRoot.scrollTop = target.top - PAGE_PADDING;
      navigationTarget.current = { page: target.number, top: scrollRoot.scrollTop };
      reportedPage.current = target.number;
      initialPositionRestored.current = true;
    }
  }, [positions, scrollRoot, page]);

  useEffect(
    () => () => {
      selectionGeneration.current++;
      if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    setPdf(null);
    setBytes(null);
    setSizes([]);
    setError("");
    void services.library
      .loadPdf(document.id)
      .then((loadedBytes) => {
        if (cancelled) return;
        setBytes(loadedBytes);
        // PDF.js transfers its input to its rendering worker. Keep a separate
        // buffer for the PDFium/Docling analysis service.
        task = pdfjs.getDocument({ data: loadedBytes.slice() });
        return task.promise;
      })
      .then(async (loaded) => {
        if (!loaded || cancelled) return;
        setPdf(loaded);
        const [pdfOutline, pageSizes] = await Promise.all([
          loaded.getOutline(),
          Promise.all(
            Array.from({ length: loaded.numPages }, async (_, index): Promise<PageSize> => {
              // Only load page metadata here, not full-resolution page canvases.
              const pageProxy = await loaded.getPage(index + 1);
              const viewport = pageProxy.getViewport({ scale: 1 });
              return { number: index + 1, width: viewport.width, height: viewport.height };
            }),
          ),
        ]);
        if (!cancelled) {
          setOutline((pdfOutline || []) as OutlineItem[]);
          setSizes(pageSizes);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(String(cause));
      });
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [document.id]);

  const renderOutline = (items: OutlineItem[], depth = 0): React.ReactNode =>
    items
      .map((item, index) => (
        <button
          key={`${depth}-${index}-${item.title}`}
          className="rounded-[5px] border-0 bg-transparent py-[6px] text-left text-[10px] leading-[1.4] text-[#61748d] hover:bg-[#edf4fc] hover:text-[#2e69c0]"
          style={{ paddingLeft: 14 + depth * 20 }}
          onClick={() => {
            if (!pdf || !item.dest) return;
            void (async () => {
              const destination =
                typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest;
              if (Array.isArray(destination) && destination[0]) {
                const number = await pdf.getPageIndex(destination[0] as RefProxy);
                jumpToPage(number + 1);
              }
            })().catch(() => undefined);
          }}
        >
          {item.title}
        </button>
      ))
      .flatMap((element, index) => [
        element,
        ...(items[index].items?.length ? [renderOutline(items[index].items!, depth + 1)] : []),
      ]);

  const visibleThumbnails = pdf
    ? Array.from({ length: pdf.numPages }, (_, index) => index + 1)
    : [];

  return (
    <div className="flex min-w-0 flex-1">
      {sidebarOpen && (
        <aside className="flex w-[186px] flex-none flex-col border-r border-[#e7ecf3] bg-[#fcfdff] px-[11px] py-[17px] max-desktop:w-[158px] max-compact:hidden">
          <div className="flex items-center gap-[7px] px-[2px] pb-[14px] text-[12px]">
            <strong>{t("reader.pages")}</strong>
            <span className="ml-auto text-[10px] text-[#a5b0bd]">
              {t("common.pages", { count: pdf?.numPages || document.pageCount })}
            </span>
            <button
              className={ui.iconButton}
              onClick={onToggleSidebar}
              title={t("reader.collapseSidebar")}
            >
              <Columns2 size={16} />
            </button>
          </div>
          <form
            className={cx(ui.searchBox, "h-[32px] pr-[3px]")}
            onSubmit={(event) => {
              event.preventDefault();
              const target = Number(query.trim());
              if (
                !/^\d+$/.test(query.trim()) ||
                !Number.isInteger(target) ||
                target < 1 ||
                target > (pdf?.numPages || document.pageCount)
              ) {
                setInvalidPage(true);
                return;
              }
              jumpToPage(target);
              setQuery(String(target));
              setInvalidPage(false);
            }}
          >
            <input
              className={ui.searchInput}
              inputMode="numeric"
              aria-label={t("reader.jumpToPage")}
              aria-invalid={invalidPage}
              aria-describedby={invalidPage ? pageErrorId : undefined}
              disabled={!positions.length}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setInvalidPage(false);
              }}
              placeholder={t("reader.jumpToPage")}
            />
            <button
              type="submit"
              aria-label={t("reader.jumpSubmit")}
              title={t("reader.jumpSubmit")}
              disabled={!positions.length || !query.trim()}
              className="grid size-[24px] flex-none place-items-center rounded-md border-0 bg-transparent text-[#69809e] hover:bg-brand-soft hover:text-brand disabled:opacity-40"
            >
              <ArrowRight size={15} />
            </button>
          </form>
          {invalidPage && (
            <p id={pageErrorId} role="alert" className="mt-2 text-[10px] text-danger">
              {t("reader.invalidPage", { count: pdf?.numPages || document.pageCount })}
            </p>
          )}
          <div className="flex-1 overflow-y-auto px-[3px] py-5">
            <div className={cx(ui.eyebrow, "mb-[11px]")}>{t("reader.previews")}</div>
            {visibleThumbnails.map((number) => (
              <Thumbnail
                key={number}
                pdf={pdf!}
                number={number}
                active={page === number}
                onClick={() => jumpToPage(number)}
              />
            ))}
            {outline.length > 0 && (
              <>
                <div className="my-5 h-px bg-[#e8edf4]" />
                <div className={cx(ui.eyebrow, "mb-[11px]")}>{t("reader.outline")}</div>
                <div className="flex flex-col">{renderOutline(outline)}</div>
              </>
            )}
          </div>
        </aside>
      )}
      <section
        className="flex min-w-0 flex-1 flex-col bg-reader"
        style={{ backgroundColor: extensions.background }}
      >
        <div className="flex h-12 flex-none items-center gap-1 border-b border-[#e4eaf1] bg-white px-[13px] whitespace-nowrap">
          {!sidebarOpen && (
            <button
              className={ui.iconButton}
              onClick={onToggleSidebar}
              title={t("reader.expandSidebar")}
            >
              <Columns2 size={17} />
            </button>
          )}
          {extensions.tools.map(({ tool }) => (
            <button
              key={tool.id}
              className={ui.toolbarButton}
              aria-pressed={mode === tool.id}
              aria-label={label(tool.title, i18n.resolvedLanguage)}
              title={label(tool.tooltip, i18n.resolvedLanguage)}
              onClick={() => {
                setMode(tool.id);
                clearSelection();
              }}
            >
              <span aria-hidden="true">{label(tool.icon, i18n.resolvedLanguage)}</span>
              {label(tool.title, i18n.resolvedLanguage)}
            </button>
          ))}
          <ExtensionToolbar />
          <button
            className={ui.toolbarButton}
            aria-pressed={mode === "text"}
            onClick={() => {
              setMode("text");
              clearSelection();
            }}
          >
            <TextCursor size={16} />
            {t("reader.text")}
          </button>
          <button
            className={ui.toolbarButton}
            aria-pressed={showLayout}
            onClick={() => setShowLayout((value) => !value)}
          >
            <Layers3 size={16} />
            {t("reader.layout")}
          </button>
          <button className={ui.toolbarButton} aria-pressed={chatOpen} onClick={onToggleChat}>
            ✦ {t("reader.ask")}
          </button>
          <span
            className="min-w-0 flex-1 truncate px-[7px] text-center text-[10px] text-[#9daaba] max-desktop:hidden"
            title={document.title}
          >
            {document.title}
          </span>
          <button
            className={ui.iconButton}
            disabled={page <= 1}
            onClick={() => jumpToPage(page - 1)}
            title={t("reader.previous")}
          >
            <ChevronLeft size={17} />
          </button>
          <span className="px-[5px] text-[10px] text-[#637890]">
            {t("reader.position", { page, total: pdf?.numPages || document.pageCount })}
          </span>
          <button
            className={ui.iconButton}
            disabled={page >= (pdf?.numPages || document.pageCount)}
            onClick={() => jumpToPage(page + 1)}
            title={t("reader.next")}
          >
            <ChevronRight size={17} />
          </button>
          <button
            className={ui.iconButton}
            disabled={zoom <= 0.5}
            onClick={() => changeZoom(-0.1)}
            title={t("reader.zoomOut")}
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-[10px] text-[#6f829a]">{Math.round(zoom * 100)}%</span>
          <button
            className={ui.iconButton}
            disabled={zoom >= MAX_ZOOM}
            onClick={() => changeZoom(0.1)}
            title={t("reader.zoomIn")}
          >
            <ZoomIn size={16} />
          </button>
        </div>
        <div
          data-ui="analysis-strip"
          data-phase={progress.phase}
          className="flex min-h-[31px] flex-none items-center gap-4 border-b border-[#e6ebf0] bg-[#f6f8fb] px-[18px] py-[7px] text-[11px] text-[#617184] data-[phase=error]:text-[#a44335]"
          role="status"
        >
          <span>{selecting ? t("reader.selecting") : localizeMessage(progress.message)}</span>
          {progress.phase === "analyzing" && (
            <span>
              {t("reader.completed", { completed: progress.completed, total: progress.total })}
            </span>
          )}
          {progress.phase === "error" && (
            <button
              className="rounded-[5px] border border-[#dce3eb] bg-white px-2 py-[2px] text-inherit"
              onClick={retry}
            >
              {t("reader.retryAnalysis")}
            </button>
          )}
          {showLayout && semanticPage?.warnings.length ? (
            <span title={semanticPage.warnings.map(localizeMessage).join("\n")}>
              {t("reader.warnings", { count: semanticPage.warnings.length })}
            </span>
          ) : null}
        </div>
        <div
          ref={setScrollRoot}
          data-ui="pdf-scroll"
          onScroll={handleScroll}
          onWheel={() => {
            paneNavigation.current = false;
          }}
          onPointerDown={() => {
            paneNavigation.current = false;
          }}
          onKeyDown={() => {
            paneNavigation.current = false;
          }}
          className="relative min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
        >
          <div className="flex w-max min-w-full flex-col items-center gap-6 px-[35px] py-7">
            {pdf &&
              positions.map((position) => (
                <PdfPageView
                  key={position.number}
                  pdf={pdf}
                  documentId={document.id}
                  position={position}
                  zoom={zoom}
                  mode={activeTool ? "region" : "text"}
                  tool={activeTool?.tool}
                  pluginDecorations={extensions.decorations
                    .filter(
                      (item) => item.documentId === document.id && item.page === position.number,
                    )
                    .flatMap((item) => item.decorations)}
                  showLayout={showLayout}
                  semanticPage={semanticPages.get(position.number)}
                  scrollRoot={scrollRoot}
                  selection={selection}
                  selectionGeneration={selectionGeneration}
                  getSemanticPage={getSemanticPage}
                  onSelection={(value) => onSelection(value, activeTool?.owner)}
                  onPageFocus={(number) => {
                    navigationTarget.current = null;
                    reportPage(number);
                  }}
                  onBusy={setSelecting}
                  onError={setError}
                />
              ))}
          </div>
          {!positions.length && !error && (
            <div className="absolute top-[45%] left-1/2 -translate-1/2 rounded-lg bg-white px-[18px] py-3 text-[12px] text-[#66809f]">
              {t("messages.loadingPaper")}
            </div>
          )}
        </div>
        {error && (
          <div
            data-ui="reader-error"
            role="alert"
            className="flex-none border-t border-[#e6ebf0] bg-white px-[18px] py-3 text-[12px] text-[#c03946]"
          >
            {localizeMessage(error)}
          </div>
        )}
      </section>
    </div>
  );
}
