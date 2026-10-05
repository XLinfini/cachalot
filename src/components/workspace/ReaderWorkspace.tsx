import { Bookmark, BookOpen, ChevronLeft, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentRecord, Provider } from "../../domain/records";
import type { ReaderSelection } from "../../domain/reader";
import PdfReader from "../PdfReader";
import ChatPanel from "../ChatPanel";
import { ExtensionDock, ExtensionStatusBar } from "../extensions/ExtensionWorkbench";
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
      <div className="flex min-h-0 min-w-0 flex-1">
        <ExtensionDock location="sidebar.left" />
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
        />
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
