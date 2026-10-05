import { BookOpen, LayoutGrid, MoreHorizontal, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CategoryRecord } from "../../domain/records";
import type { LibraryFilter } from "../../domain/categories";
import { CategorySidebar } from "../CategorySidebar";
import logo from "../../../assets/brand/cachalot-icon.png";
import { cx, ui } from "../../sdk/ui/styles";

interface Props {
  categories: CategoryRecord[];
  selected: LibraryFilter | null;
  onLibrary: () => void;
  onSelect: (filter: LibraryFilter) => void;
  onCreateCategory: () => void;
  onRemoveCategory: (category: CategoryRecord) => void;
  onOpenSettings: () => void;
}

/** Global navigation stays mounted while switching library/reader views. */
export function AppSidebar({
  categories,
  selected,
  onLibrary,
  onSelect,
  onCreateCategory,
  onRemoveCategory,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation();
  return (
    <aside
      data-ui="app-nav"
      className="flex min-h-0 w-[204px] flex-none flex-col border-r border-[#e6ecf4] bg-panel px-[13px] pt-[25px] pb-[14px] max-desktop:w-[170px] max-compact:w-[150px]"
    >
      <button
        className="flex h-[61px] items-center justify-start gap-[2px] border-0 bg-transparent pb-[30px]"
        onClick={onLibrary}
      >
        <img className="h-[42px] w-[58px] flex-none object-contain object-left" src={logo} alt="" />
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
          aria-pressed={selected === "all"}
          onClick={() => onSelect("all")}
        >
          <LayoutGrid size={18} />
          {t("nav.all")}
        </button>
        <button
          className={ui.navButton}
          aria-pressed={selected === "recent"}
          onClick={() => onSelect("recent")}
        >
          <BookOpen size={18} />
          {t("nav.recent")}
        </button>
      </div>
      <CategorySidebar
        categories={categories}
        selected={selected}
        onSelect={onSelect}
        onCreate={onCreateCategory}
        onRemove={onRemoveCategory}
      />
      <div className="flex-none border-t border-[#e4eaf1] pt-[9px]">
        <button className={ui.navButton} onClick={onOpenSettings}>
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
  );
}
