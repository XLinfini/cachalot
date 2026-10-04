import { useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { ChevronRight } from "lucide-react";
import * as pdfjs from "pdfjs-dist";
import { useTranslation } from "react-i18next";
import { selectRegion } from "../../application/select-region";
import { area, containsCenter } from "../../domain/geometry";
import type { SelectedRegion } from "../../domain/analysis";
import type { SemanticPageView } from "../../domain/document-semantics";
import { message } from "../../domain/messages";
import { cx } from "../ui/styles";
import { PDF_SCALE, type PagePosition } from "./page-layout";

// Keep complete class names so Tailwind can discover them statically.
const BLOCK_COLORS = {
  default: "border-layout bg-layout/4 [&>span]:bg-layout",
  figure: "border-figure bg-figure/4 [&>span]:bg-figure",
  formula: "border-formula bg-formula/4 [&>span]:bg-formula",
};
type Rect = { x: number; y: number; width: number; height: number };
interface Props {
  pdf: pdfjs.PDFDocumentProxy;
  documentId: string;
  position: PagePosition;
  zoom: number;
  mode: "region" | "text";
  showLayout: boolean;
  semanticPage?: SemanticPageView;
  scrollRoot: HTMLDivElement | null;
  selection: SelectedRegion | null;
  selectionGeneration: RefObject<number>;
  getSemanticPage: (page: number) => Promise<SemanticPageView>;
  onSelection: (selection: SelectedRegion | null) => void;
  onTranslate: () => void;
  onPageFocus: (page: number) => void;
  onBusy: (busy: boolean) => void;
  onError: (error: string) => void;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Each page owns its canvas, text layer and selection coordinates. Only nearby
 * canvases are retained; fixed placeholders keep the document's scroll geometry.
 * Parsing and caching remain in the shared document analysis session. */
export function PdfPageView({
  pdf,
  documentId,
  position,
  zoom,
  mode,
  showLayout,
  semanticPage,
  scrollRoot,
  selection,
  selectionGeneration,
  getSemanticPage,
  onSelection,
  onTranslate,
  onPageFocus,
  onBusy,
  onError,
}: Props) {
  const { t } = useTranslation();
  const { number, width, height } = position;
  const pageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const pendingGeneration = useRef<number | null>(null);
  const [nearby, setNearby] = useState(false);
  const [rendered, setRendered] = useState(false);
  const [box, setBox] = useState<Rect | null>(null);

  useEffect(() => {
    if (!scrollRoot || !pageRef.current) return;
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), {
      root: scrollRoot,
      rootMargin: "800px 0px",
    });
    observer.observe(pageRef.current);
    return () => observer.disconnect();
  }, [scrollRoot]);

  useEffect(() => {
    dragStart.current = null;
    pendingGeneration.current = null;
    setBox(null);
  }, [mode, zoom]);

  useEffect(() => {
    setRendered(false);
    if (!nearby) return;
    let cancelled = false;
    let task: pdfjs.RenderTask | undefined;
    let layer: pdfjs.TextLayer | undefined;
    let pdfPage: pdfjs.PDFPageProxy | undefined;
    let textWork: Promise<unknown> | undefined;
    const work = pdf
      .getPage(number)
      .then(async (loaded) => {
        pdfPage = loaded;
        if (cancelled || !canvasRef.current) return;
        const scale = zoom * PDF_SCALE;
        const viewport = loaded.getViewport({ scale });
        const canvas = canvasRef.current;
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        task = loaded.render({
          canvas,
          viewport,
          transform: [outputScale, 0, 0, outputScale, 0, 0],
        });
        textWork = loaded
          .getTextContent()
          .then(async (content) => {
            if (cancelled || !textLayerRef.current) return;
            const container = textLayerRef.current;
            container.replaceChildren();
            container.style.setProperty("--total-scale-factor", String(scale));
            layer = new pdfjs.TextLayer({ textContentSource: content, container, viewport });
            await layer.render();
          })
          .catch(() => undefined);
        await task.promise;
        if (!cancelled) setRendered(true);
      })
      .catch((cause: unknown) => {
        if (!cancelled) onError(String(cause));
      });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
      // Release PDF.js page resources only after outstanding render/text work
      // settles. cleanup() defers itself if a thumbnail is also rendering.
      void work.then(async () => {
        await textWork;
        pdfPage?.cleanup();
      });
    };
    // Callbacks and analysis updates must not cancel an otherwise valid render.
  }, [pdf, number, zoom, nearby]);

  const point = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = pageRef.current!.getBoundingClientRect();
    return {
      x: clamp(event.clientX - bounds.left, 0, bounds.width),
      y: clamp(event.clientY - bounds.top, 0, bounds.height),
    };
  };
  const cropImage = (rect: Rect): string => {
    const canvas = canvasRef.current!;
    const crop = window.document.createElement("canvas");
    const factorX = canvas.width / width,
      factorY = canvas.height / height;
    crop.width = Math.max(1, Math.round(rect.width * factorX));
    crop.height = Math.max(1, Math.round(rect.height * factorY));
    crop
      .getContext("2d")
      ?.drawImage(
        canvas,
        rect.x * factorX,
        rect.y * factorY,
        rect.width * factorX,
        rect.height * factorY,
        0,
        0,
        crop.width,
        crop.height,
      );
    return crop.toDataURL("image/png");
  };
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!rendered || event.button !== 0) return;
    selectionGeneration.current++;
    onBusy(false);
    onError("");
    onSelection(null);
    onPageFocus(number);
    if (mode !== "region") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = point(event);
    setBox({ ...dragStart.current, width: 0, height: 0 });
  };
  const handlePointerCancel = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    selectionGeneration.current++;
    setBox(null);
    onBusy(false);
    onSelection(null);
  };
  const dragRect = (event: PointerEvent<HTMLDivElement>): Rect => {
    const start = dragStart.current!,
      current = point(event);
    return {
      x: Math.min(start.x, current.x),
      y: Math.min(start.y, current.y),
      width: Math.abs(current.x - start.x),
      height: Math.abs(current.y - start.y),
    };
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStart.current) setBox(dragRect(event));
  };
  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !canvasRef.current) return;
    const rect = dragRect(event);
    dragStart.current = null;
    if (rect.width < 16 || rect.height < 16) {
      setBox(null);
      return;
    }
    setBox(rect);
    const normalized = {
      x: rect.x / width,
      y: rect.y / height,
      width: rect.width / width,
      height: rect.height / height,
    };
    const imageDataUrl = cropImage(rect);
    const generation = ++selectionGeneration.current;
    pendingGeneration.current = generation;
    onBusy(true);
    void getSemanticPage(number)
      .then((view) => {
        if (generation !== selectionGeneration.current) return;
        const selected = selectRegion(view, [
          normalized.x,
          normalized.y,
          normalized.x + normalized.width,
          normalized.y + normalized.height,
        ]);
        onSelection({ documentId, page: number, ...normalized, ...selected, imageDataUrl });
      })
      .catch((cause: unknown) => {
        if (generation === selectionGeneration.current) onError(String(cause));
      })
      .finally(() => {
        if (generation === selectionGeneration.current) onBusy(false);
        if (pendingGeneration.current === generation) pendingGeneration.current = null;
      });
  };
  const handleTextSelection = () => {
    if (
      mode !== "text" ||
      !rendered ||
      !canvasRef.current ||
      !pageRef.current ||
      !textLayerRef.current
    )
      return;
    const selected = window.getSelection(),
      text = selected?.toString().trim();
    if (!text || !selected?.rangeCount) return;
    const range = selected.getRangeAt(0),
      layer = textLayerRef.current;
    // Native cross-page text selection remains available for copying, but a
    // translation crop must belong to one page. Never silently crop the wrong one.
    if (!layer.contains(range.startContainer) || !layer.contains(range.endContainer)) {
      if (range.intersectsNode(layer)) {
        onSelection(null);
        onError(message("singlePageSelection"));
      }
      return;
    }
    const bounds = pageRef.current.getBoundingClientRect(),
      rangeBounds = range.getBoundingClientRect();
    const x = clamp(rangeBounds.left - bounds.left, 0, width),
      y = clamp(rangeBounds.top - bounds.top, 0, height);
    const rect = {
      x,
      y,
      width: clamp(rangeBounds.right - bounds.left - x, 1, width - x),
      height: clamp(rangeBounds.bottom - bounds.top - y, 1, height - y),
    };
    setBox(rect);
    const generation = ++selectionGeneration.current;
    onBusy(true);
    onPageFocus(number);
    const normalized = {
      x: rect.x / width,
      y: rect.y / height,
      width: rect.width / width,
      height: rect.height / height,
    };
    // Use individual DOM range rectangles, not its overall bounding rectangle:
    // a two-line selection must not absorb unrelated text to either side.
    const glyphBoxes = Array.from(range.getClientRects()).map(
      (r) =>
        [
          (r.left - bounds.left) / width,
          (r.top - bounds.top) / height,
          (r.right - bounds.left) / width,
          (r.bottom - bounds.top) / height,
        ] as [number, number, number, number],
    );
    const imageDataUrl = cropImage(rect);
    void getSemanticPage(number)
      .then((view) => {
        if (generation !== selectionGeneration.current) return;
        const selectedGlyphs = new Set(
          view.facts.characters
            .filter((c) => area(c.box) > 0 && glyphBoxes.some((b) => containsCenter(b, c.box)))
            .map((c) => c.index),
        );
        const result = selectRegion(
          view,
          [
            normalized.x,
            normalized.y,
            normalized.x + normalized.width,
            normalized.y + normalized.height,
          ],
          selectedGlyphs,
        );
        onSelection({
          documentId,
          page: number,
          ...normalized,
          ...result,
          text:
            result.formulas.length || result.blocks.some((block) => block.headingLevel)
              ? result.text
              : text,
          imageDataUrl,
        });
      })
      .catch((cause) => {
        if (generation === selectionGeneration.current) onError(String(cause));
      })
      .finally(() => {
        if (generation === selectionGeneration.current) onBusy(false);
      });
  };
  const ownSelection =
    selection?.documentId === documentId && selection.page === number ? selection : null;
  const visibleBox = ownSelection
    ? {
        x: ownSelection.x * width,
        y: ownSelection.y * height,
        width: ownSelection.width * width,
        height: ownSelection.height * height,
      }
    : dragStart.current || pendingGeneration.current === selectionGeneration.current
      ? box
      : null;

  return (
    <div
      ref={pageRef}
      data-ui="pdf-page"
      data-page={number}
      data-rendered={rendered && nearby}
      aria-label={t("reader.page", { page: number })}
      className="relative flex-none touch-none bg-white shadow-[0_10px_24px_#28405a34]"
      style={{ width, height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onMouseUp={handleTextSelection}
    >
      {nearby && (
        <>
          <canvas key={zoom} className="block" ref={canvasRef} />
          <div
            key={`text-${zoom}`}
            ref={textLayerRef}
            className={cx(
              "textLayer",
              mode === "text" ? "pointer-events-auto" : "pointer-events-none",
            )}
          />
        </>
      )}
      {showLayout &&
        semanticPage?.blocks
          .filter((block) => block.confidence > 0)
          .map((block) => (
            <div
              key={block.id}
              data-ui="layout-box"
              data-kind={block.kind}
              className={cx(
                "pointer-events-none absolute z-[3] border [&>span]:absolute [&>span]:-top-[14px] [&>span]:-left-px [&>span]:px-1 [&>span]:py-px [&>span]:text-[9px] [&>span]:leading-3 [&>span]:whitespace-nowrap [&>span]:text-white",
                BLOCK_COLORS[
                  block.kind === "figure" || block.kind === "table"
                    ? "figure"
                    : block.kind === "formula"
                      ? "formula"
                      : "default"
                ],
              )}
              style={{
                left: `${block.box[0] * 100}%`,
                top: `${block.box[1] * 100}%`,
                width: `${(block.box[2] - block.box[0]) * 100}%`,
                height: `${(block.box[3] - block.box[1]) * 100}%`,
              }}
            >
              <span>
                {t(`reader.blocks.${block.kind}`)} {Math.round(block.confidence * 100)}%
              </span>
            </div>
          ))}
      {mode === "region" && <div className="absolute inset-0 cursor-crosshair" />}
      {visibleBox && (
        <div
          className="pointer-events-none absolute border-2 border-[#2d76d9] bg-[#327be5]/16"
          style={{
            left: visibleBox.x,
            top: visibleBox.y,
            width: visibleBox.width,
            height: visibleBox.height,
          }}
        />
      )}
      {ownSelection && (
        <button
          className="absolute z-[2] flex items-center gap-[7px] rounded-lg border border-[#d7e5f6] bg-white px-[10px] py-[7px] text-[11px] whitespace-nowrap text-[#2968c2] shadow-[0_4px_13px_#28446f2a]"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onTranslate}
          style={{
            left: Math.min(visibleBox?.x || 0, width - 150),
            top: Math.min((visibleBox?.y || 0) + (visibleBox?.height || 0) + 10, height - 45),
          }}
        >
          <span className="grid size-[18px] place-items-center rounded-[4px] bg-[#e5f0ff] font-bold">
            {t("reader.translateIcon")}
          </span>
          {t("reader.translate")} <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
