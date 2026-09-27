import { FolderOpen, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentRecord } from "../domain/records";
import { dateLocale } from "../i18n";
import DocumentPreview from "./DocumentPreview";
import { ActionMenu, menuItem } from "./ui/ActionMenu";
import { cx } from "./ui/styles";

export function LibraryDocumentCard({
  document,
  index,
  onOpen,
  onStar,
  onMove,
  onDelete,
}: {
  document: DocumentRecord;
  index: number;
  onOpen: () => void;
  onStar: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article
      data-ui="document-card"
      data-document-id={document.id}
      tabIndex={0}
      className="group/document relative cursor-pointer overflow-hidden rounded-card border border-[#e7edf5] bg-white shadow-card transition-[transform,box-shadow] duration-150 hover:-translate-y-[3px] hover:shadow-card-hover focus-visible:outline-brand"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && ["Enter", " "].includes(event.key)) {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div
        className={cx(
          "grid h-[190px] place-items-center",
          ["bg-[#e9f1fb]", "bg-[#eaf2f5]", "bg-[#eff0fb]", "bg-[#f0f4ed]"][index % 4],
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
          <span>
            {new Date(document.updatedAt * 1000).toLocaleDateString(dateLocale(), {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span>
            {t("library.progress", { page: document.currentPage, total: document.pageCount })}
          </span>
        </div>
      </div>
      <ActionMenu
        kind="document"
        label={t("library.actions", { title: document.title })}
        triggerClassName="absolute top-[9px] right-[9px] rounded-[6px] bg-white/90 opacity-0 group-hover/document:opacity-100 group-focus-within/document:opacity-100 pointer-coarse:opacity-100"
      >
        {(close) => (
          <>
            <button
              role="menuitem"
              className={menuItem}
              onClick={() => {
                close();
                onStar();
              }}
            >
              <Star size={16} fill={document.starred ? "currentColor" : "none"} />
              {t(document.starred ? "common.unstar" : "common.star")}
            </button>
            <button
              role="menuitem"
              className={menuItem}
              onClick={() => {
                close();
                onMove();
              }}
            >
              <FolderOpen size={16} />
              {t("categories.move")}
            </button>
            <div role="separator" className="my-1 border-t border-border" />
            <button
              role="menuitem"
              className={cx(menuItem, "text-danger")}
              onClick={() => {
                close();
                onDelete();
              }}
            >
              <Trash2 size={16} />
              {t("common.delete")}
            </button>
          </>
        )}
      </ActionMenu>
    </article>
  );
}
