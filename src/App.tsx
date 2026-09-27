import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FolderOpen,
  LayoutGrid,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  Star,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { services } from "./application/services";
import type { DocumentRecord, Provider } from "./domain/records";
import type { SelectedRegion } from "./domain/analysis";
import PdfReader from "./components/PdfReader";
import DocumentPreview from "./components/DocumentPreview";
import ChatPanel from "./components/ChatPanel";
import ProviderSettings from "./components/ProviderSettings";
import TranslationPopup from "./components/TranslationPopup";
import logo from "../assets/brand/cachalot-icon.png";
import { cx, ui } from "./components/ui/styles";
import { useTranslation } from "react-i18next";
import { dateLocale } from "./i18n";
import { localizeMessage } from "./i18n/messages";
import { hasAddedModel } from "./domain/provider-models";

type View = "library" | "reader" | "settings";
type Filter = "all" | "starred" | "recent";

function dateLabel(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString(dateLocale(), {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function App() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>("library");
  const [lastView, setLastView] = useState<"library" | "reader">("library");
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<{ providerId: string; modelId: string } | null>(
    null,
  );
  const [vision, setVision] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [selection, setSelection] = useState<SelectedRegion | null>(null);
  const [translationOpen, setTranslationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const activeDocument = documents.find((document) => document.id === activeId) || null;
  const configuredProvider =
    providers.find((provider) => provider.id === activeProviderId && provider.enabled) || null;
  const activeProvider = configuredProvider
    ? {
        ...configuredProvider,
        modelId:
          activeModel?.providerId === configuredProvider.id &&
          hasAddedModel(configuredProvider, activeModel.modelId)
            ? activeModel.modelId
            : configuredProvider.modelId,
      }
    : null;

  useEffect(() => {
    let cancelled = false;
    setVision(false);
    if (configuredProvider && activeProvider)
      void services.providers
        .supportsImages(configuredProvider, activeProvider.modelId)
        .then((value) => {
          if (!cancelled) setVision(value);
        })
        .catch((cause) => setNotice(String(cause)));
    return () => {
      cancelled = true;
    };
  }, [activeProviderId, activeProvider?.modelId, providers]);

  const refreshDocuments = async () => {
    setDocuments(await services.library.list());
  };

  useEffect(() => {
    void Promise.all([
      services.library.list(),
      services.providers.list(),
      services.settings.get("activeProviderId"),
      services.settings.get("activeModel"),
    ])
      .then(([docs, modelProviders, providerId, model]) => {
        let restored: { providerId: string; modelId: string } | null = null;
        try {
          const value = JSON.parse(model || "null");
          if (
            typeof value?.providerId === "string" &&
            typeof value?.modelId === "string" &&
            modelProviders.some(
              (provider) =>
                provider.enabled &&
                provider.id === value.providerId &&
                hasAddedModel(provider, value.modelId),
            )
          )
            restored = value;
        } catch {
          /* Ignore invalid UI selection data without changing credentials. */
        }
        setActiveModel(restored);
        setDocuments(docs);
        setProviders(modelProviders);
        setActiveProviderId(
          restored?.providerId ||
            providerId ||
            modelProviders.find((item) => item.enabled)?.id ||
            null,
        );
      })
      .catch((cause: unknown) => setNotice(String(cause)));
  }, []);

  useEffect(() => {
    if (
      !activeModel ||
      providers.some(
        (provider) =>
          provider.enabled &&
          provider.id === activeModel.providerId &&
          hasAddedModel(provider, activeModel.modelId),
      )
    )
      return;
    // Removing a model invalidates live and saved choices, not message history.
    setActiveModel(null);
    void services.settings.set("activeModel", "").catch((cause) => setNotice(String(cause)));
  }, [providers, activeModel]);

  const setProvider = (id: string | null) => {
    setActiveProviderId(id);
    setActiveModel(null);
    void services.settings.set("activeModel", "").catch((cause) => setNotice(String(cause)));
    void services.settings
      .set("activeProviderId", id || "")
      .catch((cause: unknown) => setNotice(String(cause)));
  };

  const chooseModel = (providerId: string, modelId: string) => {
    const selected = { providerId, modelId };
    setActiveProviderId(providerId);
    setActiveModel(selected);
    void services.settings
      .set("activeModel", JSON.stringify(selected))
      .then(() => services.settings.set("activeProviderId", providerId))
      .catch((cause) => setNotice(String(cause)));
  };

  const openDocument = (document: DocumentRecord) => {
    setActiveId(document.id);
    setPage(document.currentPage);
    setSelection(null);
    setTranslationOpen(false);
    setView("reader");
  };

  const changePage = (next: number) => {
    if (!activeDocument) return;
    const valid = Math.max(1, Math.min(activeDocument.pageCount, next));
    setPage(valid);
    setDocuments((current) =>
      current.map((item) =>
        item.id === activeDocument.id ? { ...item, currentPage: valid } : item,
      ),
    );
    void services.library
      .setProgress(activeDocument.id, valid)
      .catch((cause: unknown) => setNotice(String(cause)));
  };

  const openSettings = () => {
    setLastView(view === "reader" ? "reader" : "library");
    setView("settings");
  };

  const importFiles = async (files: FileList | File[]) => {
    setBusy(true);
    setNotice("");
    try {
      let first: DocumentRecord | null = null;
      for (const file of Array.from(files)) {
        const saved = await services.library.importPaper(file);
        first ||= saved;
      }
      await refreshDocuments();
      if (first) openDocument(first);
    } catch (cause) {
      setNotice(String(cause));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleStar = async (document: DocumentRecord) => {
    try {
      await services.library.setStarred(document.id, !document.starred);
      await refreshDocuments();
    } catch (cause) {
      setNotice(String(cause));
    }
  };

  const deleteDocument = async (document: DocumentRecord) => {
    if (!window.confirm(t("library.deleteConfirm", { title: document.title }))) return;
    try {
      await services.library.remove(document.id);
      await refreshDocuments();
      if (activeId === document.id) {
        setActiveId(null);
        setView("library");
      }
    } catch (cause) {
      setNotice(String(cause));
    }
  };

  const visible = documents
    .filter(
      (document) =>
        (filter !== "starred" || document.starred) &&
        (filter !== "recent" || Date.now() / 1000 - document.updatedAt < 30 * 24 * 3600) &&
        `${document.title} ${document.fileName}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div
      className="flex h-full w-full min-w-[760px] overflow-hidden"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
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
      {view === "settings" ? (
        <ProviderSettings
          providers={providers}
          activeProviderId={activeProviderId}
          onProvidersChange={setProviders}
          onActiveProviderChange={setProvider}
          onBack={() => setView(lastView)}
          onError={setNotice}
        />
      ) : (
        <>
          <aside
            data-ui="app-nav"
            className="flex w-[204px] flex-none flex-col border-r border-[#e6ecf4] bg-panel px-[13px] pt-[25px] pb-[14px] max-desktop:w-[170px] max-compact:w-[150px]"
          >
            <button
              className="flex h-[61px] items-center justify-start gap-[2px] border-0 bg-transparent pb-[30px]"
              onClick={() => setView("library")}
            >
              <img
                className="h-[42px] w-[58px] flex-none object-contain object-left"
                src={logo}
                alt=""
              />
              <span className="-ml-1 font-brand text-[22px] font-medium tracking-[-.055em] text-[#1d344e]">
                cachalot
              </span>
            </button>
            <div className="pt-5">
              <div className={cx(ui.eyebrow, "flex items-center justify-between px-[13px] pb-3")}>
                {t("nav.workspace")}
              </div>
              <button
                className={ui.navButton}
                aria-pressed={view === "library" && filter === "all"}
                onClick={() => {
                  setFilter("all");
                  setView("library");
                }}
              >
                <LayoutGrid size={18} />
                {t("nav.all")}
              </button>
              <button
                className={ui.navButton}
                aria-pressed={view === "library" && filter === "recent"}
                onClick={() => {
                  setFilter("recent");
                  setView("library");
                }}
              >
                <BookOpen size={18} />
                {t("nav.recent")}
              </button>
              <button
                className={ui.navButton}
                aria-pressed={view === "library" && filter === "starred"}
                onClick={() => {
                  setFilter("starred");
                  setView("library");
                }}
              >
                <Star size={18} />
                {t("nav.starred")}
              </button>
            </div>
            <div className="mt-[25px] border-t border-[#e4eaf1] pt-5">
              <div className={cx(ui.eyebrow, "flex items-center justify-between px-[13px] pb-3")}>
                {t("nav.collections")} <Plus size={14} />
              </div>
              <span className="flex items-center gap-3 px-[13px] py-[9px] text-[12px] text-[#74859a]">
                <FolderOpen size={17} />
                {t("nav.papers")}
              </span>
            </div>
            <div className="flex-1" />
            <div className="border-t border-[#e4eaf1] pt-[9px]">
              <button className={ui.navButton} onClick={openSettings}>
                <Settings2 size={18} />
                {t("common.settings")}
              </button>
              <div className="mt-3 flex items-center gap-[9px] border-t border-[#e4eaf1] px-[5px] pt-4">
                <span className="grid size-[31px] place-items-center rounded-button bg-[#dce9fb] font-bold text-[#306aca]">
                  W
                </span>
                <div className="min-w-0 flex-1">
                  <strong className="block text-[10px]">{t("nav.myWorkspace")}</strong>
                  <small className="mt-[3px] block text-[10px] text-[#9ca9ba]">
                    {t("nav.localLibrary")}
                  </small>
                </div>
                <MoreHorizontal className="text-[#9aa9bc]" size={17} />
              </div>
            </div>
          </aside>
          <main className="flex min-w-0 flex-1 bg-white">
            {view === "library" || !activeDocument ? (
              <div className="w-full overflow-y-auto">
                <header className="flex h-[58px] items-center justify-between border-b border-[#edf0f5] px-[38px] text-[11px] text-[#99a8ba]">
                  <div className="flex items-center gap-[9px]">
                    {t("common.library")} <ChevronRight size={15} />{" "}
                    <strong className="text-[#3b4f68]">
                      {filter === "starred"
                        ? t("nav.starred")
                        : filter === "recent"
                          ? t("nav.recent")
                          : t("nav.all")}
                    </strong>
                  </div>
                  <button
                    className="flex items-center gap-2 border-0 bg-transparent text-[11px] text-[#6e8198]"
                    onClick={openSettings}
                  >
                    <Settings2 size={17} />
                    {t("library.modelSettings")}
                  </button>
                </header>
                <div className="mx-auto max-w-[1310px] px-[52px] py-[50px] max-desktop:px-[30px] max-desktop:py-10">
                  <div className="flex items-end justify-between">
                    <div>
                      <div className={ui.eyebrowBlue}>{t("library.eyebrow")}</div>
                      <h1 className="mt-[10px] mb-3 text-[31px] font-bold tracking-[-.04em] max-compact:text-[25px]">
                        {t("library.title")}
                        <span className="text-[#3676d1]">{t("library.punctuation")}</span>
                      </h1>
                      <p className="text-[12px] text-[#8b9aaf]">{t("library.description")}</p>
                    </div>
                    <button
                      className={cx(ui.primaryButton, "mb-[2px] h-[39px]")}
                      disabled={busy}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Plus size={19} />
                      {busy ? t("library.importing") : t("library.import")}
                    </button>
                  </div>
                  <div className="mt-[42px] flex items-center gap-[10px] border-b border-border">
                    <div className="mr-auto flex items-stretch gap-[27px]">
                      <button
                        className={ui.tabButton}
                        aria-pressed={filter === "all"}
                        onClick={() => setFilter("all")}
                      >
                        {t("nav.all")}{" "}
                        <span className="ml-1 rounded-[7px] bg-[#eaf1fb] px-[6px] py-[2px] text-[10px]">
                          {documents.length}
                        </span>
                      </button>
                      <button
                        className={ui.tabButton}
                        aria-pressed={filter === "recent"}
                        onClick={() => setFilter("recent")}
                      >
                        {t("nav.recent")}
                      </button>
                      <button
                        className={ui.tabButton}
                        aria-pressed={filter === "starred"}
                        onClick={() => setFilter("starred")}
                      >
                        {t("common.starred")}
                      </button>
                    </div>
                    <label className={cx(ui.searchBox, "mb-[9px] h-[34px] w-[220px]")}>
                      <Search size={17} />
                      <input
                        className={ui.searchInput}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t("library.search")}
                      />
                    </label>
                    <button
                      className={cx(ui.iconButton, "mb-[10px]")}
                      title={t("library.sortRecent")}
                    >
                      <ChevronDown size={17} />
                    </button>
                  </div>
                  {visible.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(235px,1fr))] gap-[22px] pt-[26px]">
                      {visible.map((document, index) => (
                        <article
                          key={document.id}
                          data-ui="document-card"
                          className="group/document relative cursor-pointer overflow-hidden rounded-card border border-[#e7edf5] bg-white shadow-card transition-[transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:shadow-card-hover"
                          onClick={() => openDocument(document)}
                        >
                          <div
                            className={cx(
                              "grid h-[190px] place-items-center",
                              ["bg-[#e9f1fb]", "bg-[#eaf2f5]", "bg-[#eff0fb]", "bg-[#f0f4ed]"][
                                index % 4
                              ],
                            )}
                          >
                            <DocumentPreview document={document} />
                          </div>
                          <div className="px-4 pt-[14px] pb-4">
                            <div className="flex gap-[7px] text-[10px] text-[#899aae]">
                              <span className="font-bold text-[#3e75c5]">PDF</span>
                              <span>{t("common.pages", { count: document.pageCount })}</span>
                            </div>
                            <h3
                              className="mt-2 mb-[7px] line-clamp-2 h-[38px] text-[13px] leading-[1.45]"
                              title={document.title}
                            >
                              {document.title}
                            </h3>
                            <p className="truncate text-[10px] text-subtle">{document.fileName}</p>
                            <div className="mt-[17px] flex justify-between gap-[5px] text-[9px] text-[#9aa8ba]">
                              <span>{dateLabel(document.updatedAt)}</span>
                              <span>
                                {t("library.progress", {
                                  page: document.currentPage,
                                  total: document.pageCount,
                                })}
                              </span>
                            </div>
                          </div>
                          <div className="absolute top-[9px] right-[9px] flex gap-1 opacity-0 group-focus-within/document:opacity-100 group-hover/document:opacity-100 [&>button]:rounded-[6px] [&>button]:border-0 [&>button]:bg-white/87 [&>button]:p-[5px] [&>button]:text-[#5780b7] [&>button:hover]:text-[#c53a44]">
                            <button
                              title={document.starred ? t("common.unstar") : t("common.star")}
                              onClick={(event) => {
                                event.stopPropagation();
                                void toggleStar(document);
                              }}
                            >
                              <Star size={17} fill={document.starred ? "currentColor" : "none"} />
                            </button>
                            <button
                              title={t("library.delete")}
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteDocument(document);
                              }}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center px-5 py-[100px] text-center">
                      <div className="mb-[19px] grid size-[82px] place-items-center rounded-[23px] bg-[#edf4ff] text-[#6e9ad7]">
                        <UploadCloud size={40} />
                      </div>
                      <h2 className="mb-2 text-[20px]">
                        {documents.length ? t("library.noMatches") : t("library.firstPaper")}
                      </h2>
                      <p className="mb-[21px] text-[12px] text-[#8d9eb1]">
                        {documents.length ? t("library.searchHint") : t("library.importHint")}
                      </p>
                      <button className={ui.primaryButton} onClick={() => fileRef.current?.click()}>
                        <FilePlus2 size={17} />
                        {t("library.importPdf")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex w-full min-w-0 flex-col">
                <header className="flex h-[51px] flex-none items-center gap-4 border-b border-[#e8edf4] px-[17px]">
                  <button
                    className={cx(ui.backLink, "whitespace-nowrap")}
                    onClick={() => setView("library")}
                  >
                    <ChevronLeft size={17} />
                    {t("common.library")}
                  </button>
                  <div className="flex h-[38px] max-w-[245px] min-w-0 items-center gap-2 self-end rounded-t-lg border border-b-0 border-[#e9eef5] bg-[#f5f8fd] px-[10px] text-[11px] text-[#46668d]">
                    <BookOpen size={16} />
                    <span className="truncate" title={activeDocument.title}>
                      {activeDocument.title}
                    </span>
                    <button
                      className="border-0 bg-transparent p-[2px] text-[#a0afbf]"
                      onClick={() => {
                        setActiveId(null);
                        setView("library");
                      }}
                      title={t("library.closeTab")}
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="flex-1" />
                  <button
                    className={ui.iconButton}
                    title={t("library.starPaper")}
                    onClick={() => void toggleStar(activeDocument)}
                  >
                    <Bookmark size={18} fill={activeDocument.starred ? "currentColor" : "none"} />
                  </button>
                </header>
                <div className="flex min-h-0 min-w-0 flex-1">
                  <PdfReader
                    key={activeDocument.id}
                    document={activeDocument}
                    page={page}
                    onPageChange={changePage}
                    selection={selection}
                    onSelection={setSelection}
                    onTranslate={() => setTranslationOpen(true)}
                    sidebarOpen={sidebarOpen}
                    onToggleSidebar={() => setSidebarOpen((value) => !value)}
                    chatOpen={chatOpen}
                    onToggleChat={() => setChatOpen((value) => !value)}
                  />
                  {chatOpen && (
                    <ChatPanel
                      key={activeDocument.id}
                      providers={providers}
                      vision={vision}
                      onSelectModel={chooseModel}
                      document={activeDocument}
                      page={page}
                      selection={selection}
                      provider={activeProvider}
                      onClose={() => setChatOpen(false)}
                      onOpenSettings={openSettings}
                      onError={setNotice}
                    />
                  )}
                </div>
              </div>
            )}
          </main>
        </>
      )}
      {notice && (
        <div
          className="fixed right-[18px] bottom-[18px] z-30 flex max-w-[460px] items-center gap-3 rounded-button bg-[#263b56] px-[15px] py-3 text-[11px] text-white shadow-[0_8px_24px_#18304d33]"
          role="alert"
        >
          <span className="max-h-[50vh] min-w-0 overflow-y-auto [overflow-wrap:anywhere] whitespace-pre-wrap">
            {localizeMessage(notice)}
          </span>
          <button
            className="grid place-items-center border-0 bg-transparent text-white"
            onClick={() => setNotice("")}
            aria-label={t("common.dismiss")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {translationOpen && selection && (
        <TranslationPopup
          selection={selection}
          provider={activeProvider}
          onClose={() => setTranslationOpen(false)}
        />
      )}
    </div>
  );
}
