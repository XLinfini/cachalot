import { ChevronRight, FilePlus2, Plus, Search, UploadCloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentRecord } from "../../domain/records";
import type { LibrarySort } from "../../domain/library-sort";
import { LibraryDocumentCard } from "../LibraryDocumentCard";
import { LibrarySortMenu } from "../LibrarySortMenu";
import { cx, ui } from "../../sdk/ui/styles";

interface Props {
  filterLabel: string;
  hasDocuments: boolean;
  visibleDocuments: DocumentRecord[];
  query: string;
  onQueryChange: (query: string) => void;
  sort: LibrarySort;
  savingSort: boolean;
  onChangeSort: (sort: LibrarySort) => Promise<void>;
  importing: boolean;
  onImport: () => void;
  onOpen: (document: DocumentRecord) => void;
  onStar: (document: DocumentRecord) => void;
  onMove: (document: DocumentRecord) => void;
  onDelete: (document: DocumentRecord) => void;
}

/** Library layout consumes controlled state; data loading/mutations live in useLibrary. */
export function LibraryPage({
  filterLabel,
  hasDocuments,
  visibleDocuments,
  query,
  onQueryChange,
  sort,
  savingSort,
  onChangeSort,
  importing,
  onImport,
  onOpen,
  onStar,
  onMove,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="w-full overflow-y-auto">
      <header className="flex h-[58px] items-center border-b border-[#edf0f5] px-[38px] text-[11px] text-[#99a8ba]">
        <div className="flex min-w-0 items-center gap-[9px]">
          {t("common.library")} <ChevronRight size={15} />{" "}
          <strong className="min-w-0 truncate text-[#3b4f68]" title={filterLabel}>
            {filterLabel}
          </strong>
        </div>
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
            disabled={importing}
            onClick={() => onImport()}
          >
            <Plus size={19} />
            {importing ? t("library.importing") : t("library.import")}
          </button>
        </div>
        <div
          data-ui="library-search"
          className="mt-[42px] flex items-center justify-center gap-[10px]"
        >
          <label className={cx(ui.searchBox, "h-[36px] w-[420px] min-w-0")}>
            <Search size={17} />
            <input
              className={ui.searchInput}
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={t("library.search")}
            />
          </label>
          <LibrarySortMenu
            value={sort}
            saving={savingSort}
            onChange={(next) => void onChangeSort(next)}
          />
        </div>
        {visibleDocuments.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(235px,1fr))] gap-[22px] pt-[26px]">
            {visibleDocuments.map((document, index) => (
              <LibraryDocumentCard
                key={document.id}
                document={document}
                index={index}
                onOpen={() => onOpen(document)}
                onStar={() => void onStar(document)}
                onMove={() => onMove(document)}
                onDelete={() => void onDelete(document)}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center px-5 py-[100px] text-center">
            <div className="mb-[19px] grid size-[82px] place-items-center rounded-[23px] bg-[#edf4ff] text-[#6e9ad7]">
              <UploadCloud size={40} />
            </div>
            <h2 className="mb-2 text-[20px]">
              {hasDocuments ? t("library.noMatches") : t("library.firstPaper")}
            </h2>
            <p className="mb-[21px] text-[12px] text-[#8d9eb1]">
              {hasDocuments ? t("library.searchHint") : t("library.importHint")}
            </p>
            <button className={ui.primaryButton} onClick={() => onImport()}>
              <FilePlus2 size={17} />
              {t("library.importPdf")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
