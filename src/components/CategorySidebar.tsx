import { FolderOpen, Plus, Star, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CategoryRecord } from "../domain/records";
import type { LibraryFilter } from "../domain/categories";
import { ActionMenu, menuItem } from "./ui/ActionMenu";
import { cx, ui } from "../sdk/ui/styles";

/** Built-in views never have a delete menu. Names and memberships come from
 * application services; the sidebar only renders and emits navigation/actions. */
export function CategorySidebar({
  categories,
  selected,
  onSelect,
  onCreate,
  onRemove,
}: {
  categories: CategoryRecord[];
  selected: LibraryFilter | null;
  onSelect: (filter: LibraryFilter) => void;
  onCreate: () => void;
  onRemove: (category: CategoryRecord) => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-ui="categories"
      className="mt-[25px] flex min-h-0 flex-1 flex-col border-t border-[#e4eaf1] pt-4"
    >
      <div
        className={cx(
          ui.eyebrow,
          "flex flex-none items-center justify-between pr-[5px] pb-2 pl-[13px]",
        )}
      >
        {t("nav.collections")}
        <button
          className={ui.iconButton}
          title={t("categories.create")}
          aria-label={t("categories.create")}
          onClick={onCreate}
        >
          <Plus size={16} />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto pb-3">
        <button
          data-ui="uncategorized-category"
          className={ui.navButton}
          aria-pressed={selected === "uncategorized"}
          onClick={() => onSelect("uncategorized")}
        >
          <FolderOpen size={17} className="flex-none" />
          <span className="truncate" title={t("nav.papers")}>
            {t("nav.papers")}
          </span>
        </button>
        <button
          data-ui="favorites-category"
          className={ui.navButton}
          aria-pressed={selected === "starred"}
          onClick={() => onSelect("starred")}
        >
          <Star size={17} className="flex-none" />
          <span className="truncate">{t("nav.starred")}</span>
        </button>
        {categories.map((category) => (
          <div
            key={category.id}
            data-ui="category-row"
            data-category-id={category.id}
            className="group/category relative"
          >
            <button
              className={cx(ui.navButton, "pr-[36px]")}
              aria-pressed={typeof selected === "object" && selected?.categoryId === category.id}
              onClick={() => onSelect({ categoryId: category.id })}
            >
              <FolderOpen size={17} className="flex-none" />
              <span className="truncate" title={category.name}>
                {category.name}
              </span>
            </button>
            <ActionMenu
              kind="category"
              label={t("categories.actions", { name: category.name })}
              triggerClassName="absolute top-1 right-1 opacity-0 group-hover/category:opacity-100 group-focus-within/category:opacity-100 pointer-coarse:opacity-100"
            >
              {(close) => (
                <button
                  role="menuitem"
                  className={cx(menuItem, "text-danger")}
                  onClick={() => {
                    close();
                    onRemove(category);
                  }}
                >
                  <Trash2 size={16} />
                  {t("categories.remove")}
                </button>
              )}
            </ActionMenu>
          </div>
        ))}
      </div>
    </section>
  );
}
