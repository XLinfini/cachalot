import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import { useTranslation } from "react-i18next";
import { ZoomIn, ZoomOut } from "lucide-react";
import { extensionHost } from "../../application/extensions/runtime";
import type { HostedPdfComparison } from "../../application/extensions/host";
import type { ReaderAnchor } from "../../sdk";
import { PdfPageView } from "./PdfPageView";
import {
  captureScrollAnchor,
  pagePositions,
  restoreScrollAnchor,
  type PageSize,
} from "./page-layout";
import { ui } from "../../sdk/ui/styles";

/** A host-owned PDF pane. It shares rendering/text layers but never publishes
 * derived selections or analysis into the original document's services. */
export function ArtifactPdfReader({ comparison }: { comparison: HostedPdfComparison }) {
  const { t } = useTranslation();
  const viewId = `${comparison.options.id}:derived`;
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<PageSize[]>([]);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const positions = useMemo(() => pagePositions(sizes, zoom), [sizes, zoom]);
  const generation = useRef(0);
  const navigation = useRef(false);
  const savedAnchor = useRef<ReaderAnchor>({ page: 1, fraction: 0 });
  const previousPositions = useRef(positions);
  useEffect(() => {
    const task = pdfjs.getDocument({ data: comparison.bytes.slice() });
    let cancelled = false;
    void task.promise
      .then(async (loaded) => {
        const sizes = [];
        for (let number = 1; number <= loaded.numPages; number++) {
          const item = await loaded.getPage(number),
            viewport = item.getViewport({ scale: 1 });
          sizes.push({ number, width: viewport.width, height: viewport.height });
        }
        if (!cancelled) {
          setPdf(loaded);
          setSizes(sizes);
        }
      })
      .catch((error) => {
        if (!cancelled) setError(String(error));
      });
    return () => {
      cancelled = true;
      void task.destroy();
      extensionHost.clearPaneState(viewId);
    };
  }, [comparison.bytes, viewId]);
  useEffect(() => {
    if (!root || !sizes.length) return;
    const fit = () =>
      setZoom(Math.max(0.2, Math.min(2, (root.clientWidth - 48) / (sizes[0].width * 0.96))));
    const resize = new ResizeObserver(fit);
    resize.observe(root);
    fit();
    return () => resize.disconnect();
  }, [root, sizes]);
  const publish = () => {
    if (!root || !positions.length) return;
    const anchor = captureScrollAnchor(positions, root.scrollTop, root.clientHeight)!;
    savedAnchor.current = anchor;
    setPage(anchor.page);
    extensionHost.publishPaneState({
      viewId,
      documentId: `artifact:${comparison.owner}:${comparison.artifact.id}`,
      page: anchor.page,
      pageCount: sizes.length,
      zoom,
      scrollTop: root.scrollTop,
      viewportHeight: root.clientHeight,
      anchor,
      cause: navigation.current ? "navigation" : "user",
    });
  };
  useEffect(() => {
    const subscription = extensionHost.onRevealPane((target) => {
      if (target.viewId !== viewId) return;
      savedAnchor.current = target.anchor;
      navigation.current = true;
      if (root && positions.length) {
        root.scrollTo({ top: restoreScrollAnchor(positions, target.anchor, root.clientHeight) });
        publish();
      }
    });
    return () => subscription.dispose();
  }, [viewId, root, positions, zoom]);
  useLayoutEffect(() => {
    if (!root || !positions.length) return;
    if (previousPositions.current !== positions) {
      navigation.current = true;
      root.scrollTop = restoreScrollAnchor(positions, savedAnchor.current, root.clientHeight);
      previousPositions.current = positions;
    }
    publish();
  }, [root, positions]);
  return (
    <section
      data-ui="artifact-pdf-reader"
      className="flex min-w-0 flex-1 flex-col border-l border-[#e4eaf1] bg-reader"
    >
      <div className="flex h-12 flex-none items-center gap-2 border-b border-[#e4eaf1] bg-white px-3 text-xs">
        <span className="min-w-0 flex-1 truncate" title={comparison.options.title}>
          {comparison.options.title}
        </span>
        <span>
          {t("reader.position", { page, total: sizes.length || comparison.derivedPageCount })}
        </span>
        <button
          className={ui.iconButton}
          title={t("reader.zoomOut")}
          onClick={() => setZoom((z) => Math.max(0.2, z - 0.1))}
        >
          <ZoomOut size={16} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          className={ui.iconButton}
          title={t("reader.zoomIn")}
          onClick={() => setZoom((z) => Math.min(5, z + 0.1))}
        >
          <ZoomIn size={16} />
        </button>
      </div>
      <div
        ref={setRoot}
        data-ui="artifact-pdf-scroll"
        className="relative min-h-0 flex-1 overflow-auto [overflow-anchor:none]"
        onScroll={publish}
        onWheel={() => {
          navigation.current = false;
        }}
        onPointerDown={() => {
          navigation.current = false;
        }}
        onKeyDown={() => {
          navigation.current = false;
        }}
      >
        <div className="flex w-max min-w-full flex-col items-center gap-6 px-6 py-7">
          {pdf &&
            positions.map((position) => (
              <PdfPageView
                key={position.number}
                passive
                pdf={pdf}
                documentId={`artifact:${comparison.artifact.id}`}
                position={position}
                zoom={zoom}
                mode="text"
                showLayout={false}
                scrollRoot={root}
                selection={null}
                selectionGeneration={generation}
                pluginDecorations={[]}
                onSelection={() => undefined}
                onPageFocus={() => undefined}
                onBusy={() => undefined}
                onError={setError}
              />
            ))}
        </div>
      </div>
      {error && (
        <p role="alert" className="m-0 bg-white px-4 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
