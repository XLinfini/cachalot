import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentRecord } from "./domain/records";
import type { ReaderSelection } from "./domain/reader";
import type { LibraryFilter } from "./domain/categories";
import { extensionHost } from "./application/extensions/runtime";
import { useLibrary } from "./hooks/useLibrary";
import { useChatModel } from "./hooks/useChatModel";
import { useWorkspaceExtensions } from "./hooks/useWorkspaceExtensions";
import { LibraryPage } from "./components/library/LibraryPage";
import { AppSidebar } from "./components/workspace/AppSidebar";
import { ReaderWorkspace } from "./components/workspace/ReaderWorkspace";
import { AppNotice } from "./components/workspace/AppNotice";
import { CreateCategoryDialog, MoveCategoryDialog } from "./components/CategoryDialogs";
import ProviderSettings from "./components/ProviderSettings";
import { SettingsDialog } from "./components/SettingsDialog";
import { ExtensionModals } from "./components/extensions/ExtensionWorkbench";

type WorkspaceView = "library" | "reader";

/** Composition root owns navigation and reader identity. Page layout, library
 * operations, model choice and extension subscriptions have separate owners. */
export default function App() {
  const [view, setView] = useState<WorkspaceView>("library");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [movingDocument, setMovingDocument] = useState<DocumentRecord | null>(null);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const settingsOpener = useRef<HTMLElement | null>(null);
  const library = useLibrary(setNotice);
  const model = useChatModel(setNotice);
  const activeDocument = library.documents.find((document) => document.id === activeId) || null;
  useWorkspaceExtensions(
    view === "reader" ? activeId : null,
    model.activeProvider,
    setSelection,
    setNotice,
  );

  const openDocument = (document: DocumentRecord) => {
    setActiveId(document.id);
    setPage(document.currentPage);
    setSelection(null);
    setView("reader");
  };
  const closeDocument = () => {
    setActiveId(null);
    setView("library");
  };
  const selectLibrary = (filter: LibraryFilter) => {
    library.setFilter(filter);
    setSelection(null);
    setView("library");
  };
  const changePage = (next: number) => {
    if (!activeDocument) return;
    const valid = Math.max(1, Math.min(activeDocument.pageCount, next));
    setPage(valid);
    library.updateProgress(activeDocument.id, valid);
  };
  const openSettings = useCallback(() => {
    if (settingsOpen) return;
    settingsOpener.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsOpen(true);
  }, [settingsOpen]);
  useEffect(() => {
    if (!settingsOpen) settingsOpener.current?.focus();
  }, [settingsOpen]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key === ",") {
        event.preventDefault();
        openSettings();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [openSettings]);
  const importFiles = async (files: FileList | File[]) => {
    const first = await library.importDocuments(files);
    if (first) openDocument(first);
    if (fileRef.current) fileRef.current.value = "";
  };
  const deleteDocument = async (document: DocumentRecord) => {
    if ((await library.removeDocument(document)) && activeId === document.id) closeDocument();
  };

  return (
    <div
      className="relative flex h-full w-full min-w-[760px] overflow-hidden"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (settingsOpen) return;
        const files = Array.from(event.dataTransfer.files).filter((file) =>
          file.name.toLowerCase().endsWith(".pdf"),
        );
        if (files.length) void importFiles(files);
      }}
    >
      <input
        ref={fileRef}
        hidden
        type="file"
        accept="application/pdf,.pdf"
        multiple
        onChange={(event) => {
          if (event.target.files) void importFiles(event.target.files);
        }}
      />
      {/* Keep reading, scroll position and pending chat requests alive beneath settings. */}
      <div
        data-ui="workspace"
        aria-hidden={settingsOpen}
        inert={settingsOpen}
        className="flex h-full w-full"
      >
        <AppSidebar
          categories={library.categories}
          selected={view === "library" ? library.filter : null}
          onLibrary={() => setView("library")}
          onSelect={selectLibrary}
          onCreateCategory={() => setCreatingCategory(true)}
          onRemoveCategory={(category) => void library.removeCategory(category)}
          onOpenSettings={openSettings}
        />
        <main className="flex min-w-0 flex-1 bg-white">
          {view === "library" || !activeDocument ? (
            <LibraryPage
              filterLabel={library.filterLabel}
              hasDocuments={library.documents.length > 0}
              visibleDocuments={library.visibleDocuments}
              query={library.query}
              onQueryChange={library.setQuery}
              sort={library.sort}
              savingSort={library.savingSort}
              onChangeSort={library.changeSort}
              importing={library.importing}
              onImport={() => fileRef.current?.click()}
              onOpen={openDocument}
              onStar={(document) => void library.toggleStar(document)}
              onMove={setMovingDocument}
              onDelete={(document) => void deleteDocument(document)}
            />
          ) : (
            <ReaderWorkspace
              key={activeDocument.id}
              document={activeDocument}
              page={page}
              selection={selection}
              onPageChange={changePage}
              onSelection={(value, owner) => extensionHost.publishSelection(value, owner)}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => setSidebarOpen((value) => !value)}
              chatOpen={chatOpen}
              onToggleChat={() => setChatOpen((value) => !value)}
              onCloseChat={() => setChatOpen(false)}
              providers={model.providers}
              provider={model.activeProvider}
              vision={model.vision}
              onSelectModel={model.chooseModel}
              onBack={() => setView("library")}
              onCloseDocument={closeDocument}
              onStar={() => void library.toggleStar(activeDocument)}
              onOpenSettings={openSettings}
              onError={setNotice}
            />
          )}
        </main>
      </div>
      {settingsOpen ? (
        <SettingsDialog onClose={() => setSettingsOpen(false)}>
          <ProviderSettings
            providers={model.providers}
            activeProviderId={model.activeProviderId}
            onProvidersChange={model.setProviders}
            defaultModel={model.defaultModel}
            onDefaultModelChange={model.chooseDefaultModel}
            onError={setNotice}
          />
          <AppNotice message={notice} onDismiss={() => setNotice("")} contained />
        </SettingsDialog>
      ) : (
        <AppNotice message={notice} onDismiss={() => setNotice("")} />
      )}
      <ExtensionModals />
      {creatingCategory && (
        <CreateCategoryDialog
          onCreate={async (name) => {
            await library.createCategory(name);
            setSelection(null);
            setView("library");
          }}
          onClose={() => setCreatingCategory(false)}
        />
      )}
      {movingDocument && (
        <MoveCategoryDialog
          document={movingDocument}
          categories={library.categories}
          onMove={(categoryId) => library.moveDocument(movingDocument.id, categoryId)}
          onClose={() => setMovingDocument(null)}
        />
      )}
    </div>
  );
}
