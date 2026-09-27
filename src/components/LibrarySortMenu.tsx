import { Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LIBRARY_SORTS, type LibrarySort } from "../domain/library-sort";
import { ActionMenu, menuItem } from "./ui/ActionMenu";

const labels = {
  "name-asc": "library.sortNameAsc",
  "name-desc": "library.sortNameDesc",
  "imported-desc": "library.sortImportedDesc",
  "imported-asc": "library.sortImportedAsc",
} as const;

/** Controlled menu: the library owns the order and persists preferences. */
export function LibrarySortMenu({
  value,
  saving,
  onChange,
}: {
  value: LibrarySort;
  saving: boolean;
  onChange: (sort: LibrarySort) => void;
}) {
  const { t } = useTranslation();
  return (
    <ActionMenu
      kind="sort"
      label={t("library.sort")}
      triggerIcon={<ChevronDown size={17} />}
      disabled={saving}
    >
      {(close) => (
        <>
          {LIBRARY_SORTS.map((sort, index) => (
            <div key={sort}>
              {index === 2 && <div role="separator" className="my-1 border-t border-border" />}
              <button
                role="menuitemradio"
                aria-checked={sort === value}
                disabled={saving}
                className={menuItem}
                onClick={() => {
                  close();
                  if (sort !== value) onChange(sort);
                }}
              >
                <span className="grid size-4 flex-none place-items-center">
                  {sort === value && <Check size={15} />}
                </span>
                {t(labels[sort])}
              </button>
            </div>
          ))}
        </>
      )}
    </ActionMenu>
  );
}
