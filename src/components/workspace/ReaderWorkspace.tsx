import { Bookmark, BookOpen, ChevronLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import type { DocumentRecord, Provider } from "../../domain/records";
import type { ReaderSelection } from "../../domain/reader";
import PdfReader from "../PdfReader";
import ChatPanel from "../ChatPanel";
import { ExtensionDock, ExtensionStatusBar, useExtensions } from "../extensions/ExtensionWorkbench";
import { ArtifactPdfReader } from "../pdf/ArtifactPdfReader";
import { extensionHost } from "../../application/extensions/runtime";
import { mapComparisonAnchor } from "../../domain/pdf-comparison";
import { cx, ui } from "../../sdk/ui/styles";

interface Props {
  document: DocumentRecord;
  page: number;
  selection: ReaderSelection | null;
  onPageChange: (page: number) => void;
  onSelection: (selection: ReaderSelection | null, owner?: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  onCloseChat: () => void;
  providers: Provider[];
  provider: Provider | null;
  vision: boolean;
  onSelectModel: (providerId: string, modelId: string) => void;
  onBack: () => void;
  onCloseDocument: () => void;
  onStar: () => void;
  onOpenSettings: () => void;
  onError: (error: string) => void;
}

/** Reader, core chat and extension docks share a document lifetime. Settings
 * covers this workspace without unmounting it; a library return unmounts it. */
export function ReaderWorkspace({
  document,
  page,
  selection,
  onPageChange,
  onSelection,
  sidebarOpen,
  onToggleSidebar,
  chatOpen,
  onToggleChat,
  onCloseChat,
  providers,
  provider,
  vision,
  onSelectModel,
  onBack,
  onCloseDocument,
  onStar,
  onOpenSettings,
  onError,
}: Props) {
  const { t } = useTranslation();
  const extensions = useExtensions();
  const comparison = extensions.comparisons.find((item) => item.options.documentId === document.id);
  const [leftWidth, setLeftWidth] = useState(50);
  const panes = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!comparison || comparison.options.synchronized === false) return;
    const sourceView = `reader:${document.id}`,
      targetView = `${comparison.options.id}:derived`;
    const subscription = extensionHost.onDidChangePaneState((state) => {
      if (
        !state?.anchor ||
        state.cause === "navigation" ||
        (state.viewId !== sourceView && state.viewId !== targetView)
      )
        return;
      const side = state.viewId === sourceView ? "original" : "derived";
      const anchor = mapComparisonAnchor(comparison.options.alignment ?? [], side, state.anchor);
      anchor.page = Math.max(
        1,
        Math.min(
          anchor.page,
          side === "original" ? comparison.derivedPageCount : comparison.originalPageCount,
        ),
      );
      extensionHost.revealPane(side === "original" ? targetView : sourceView, anchor);
    });
    return () => subscription.dispose();
  }, [comparison, document.id]);
  return (
    <div className="flex w-full min-w-0 flex-col">
      <header className="flex h-[51px] flex-none items-center gap-4 border-b border-[#e8edf4] px-[17px]">
        <button className={cx(ui.backLink, "whitespace-nowrap")} onClick={onBack}>
          <ChevronLeft size={17} />
          {t("common.library")}
        </button>
        <div className="flex h-[38px] max-w-[245px] min-w-0 items-center gap-2 self-end rounded-t-lg border border-b-0 border-[#e9eef5] bg-[#f5f8fd] px-[10px] text-[11px] text-[#46668d]">
          <BookOpen size={16} />
          <span className="truncate" title={document.title}>
            {document.title}
          </span>
          <button
            className="border-0 bg-transparent p-[2px] text-[#a0afbf]"
            onClick={onCloseDocument}
            title={t("library.closeTab")}
          >
            <X size={15} />
          </button>
        </div>
        <div className="flex-1" />
        <button
          className={ui.iconButton}
          title={t("library.starPaper")}
          onClick={() => void onStar()}
        >
          <Bookmark size={18} fill={document.starred ? "currentColor" : "none"} />
        </button>
      </header>
      {comparison && (
        <div
          data-ui="pdf-comparison-toolbar"
          className="flex flex-none items-center gap-3 border-b border-[#e8edf4] bg-[#f5f8fd] px-4 py-2 text-xs"
        >
          <span>{t("reader.comparison")}</span>
          <span className="min-w-0 flex-1 truncate">{comparison.options.title}</span>
          <button
            className={ui.toolbarButton}
            aria-pressed={comparison.options.synchronized !== false}
            onClick={() =>
              extensionHost.setPdfComparisonSynchronized(
                comparison.options.id,
                comparison.options.synchronized === false,
              )
            }
          >
            {t("reader.synchronize")}
          </button>
          <button
            className={ui.toolbarButton}
            onClick={() => extensionHost.closePdfComparison(comparison.options.id)}
          >
            {t("reader.closeComparison")}
          </button>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <ExtensionDock location="sidebar.left" />
        <div ref={panes} className="flex min-w-0 flex-1">
          <div
            data-ui="original-pdf-pane"
            className={comparison ? "flex min-w-0 flex-none" : "flex min-w-0 flex-1"}
            style={comparison ? { width: `${leftWidth}%` } : undefined}
          >
            {/* Sibling keys include the panel type so React can remove both
                      panels when returning to the library or switching documents. */}
            <PdfReader
              key={`reader:${document.id}`}
              document={document}
              page={page}
              onPageChange={onPageChange}
              selection={selection}
              onSelection={onSelection}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={onToggleSidebar}
              chatOpen={chatOpen}
              onToggleChat={onToggleChat}
              comparisonMode={!!comparison}
            />
          </div>
          {comparison && (
            <>
              <div
                role="separator"
                aria-label={t("reader.resizeComparison")}
                aria-orientation="vertical"
                aria-valuemin={30}
                aria-valuemax={70}
                aria-valuenow={Math.round(leftWidth)}
                tabIndex={0}
                className="z-10 w-1 flex-none cursor-col-resize touch-none bg-[#dce5f0] hover:bg-brand focus:bg-brand"
                onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId) || !panes.current)
                    return;
                  const bounds = panes.current.getBoundingClientRect();
                  setLeftWidth(
                    Math.max(
                      30,
                      Math.min(70, ((event.clientX - bounds.left) / bounds.width) * 100),
                    ),
                  );
                }}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault();
                    setLeftWidth((width) =>
                      Math.max(30, Math.min(70, width + (event.key === "ArrowLeft" ? -2 : 2))),
                    );
                  }
                }}
              />
              <ArtifactPdfReader comparison={comparison} />
            </>
          )}
        </div>
        <ExtensionDock location="sidebar.right" />
        {chatOpen && (
          <ChatPanel
            key={`chat:${document.id}`}
            providers={providers}
            vision={vision}
            onSelectModel={onSelectModel}
            document={document}
            page={page}
            selection={selection}
            provider={provider}
            onClose={onCloseChat}
            onOpenSettings={onOpenSettings}
            onError={onError}
          />
        )}
      </div>
      <ExtensionDock location="panel" />
      <ExtensionStatusBar />
    </div>
  );
}
