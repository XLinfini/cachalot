import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import type { CategoryRecord, DocumentRecord } from "../domain/records";
import type { LibraryFilter } from "../domain/categories";
import {
  DEFAULT_LIBRARY_SORT,
  LIBRARY_SORT_SETTING,
  parseLibrarySort,
  sortDocuments,
  type LibrarySort,
} from "../domain/library-sort";
import { dateLocale } from "../i18n";

/** Presentation state and service calls for the library. Navigation, active
 * document identity and reader lifetime remain owned by the application shell. */
export function useLibrary(onError: (error: string) => void) {
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [filter, setFilter] = useState<LibraryFilter>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>(DEFAULT_LIBRARY_SORT);
  const [savingSort, setSavingSort] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      services.library.list(),
      services.categories.list(),
      services.settings.get(LIBRARY_SORT_SETTING),
    ])
      .then(([docs, savedCategories, savedSort]) => {
        if (cancelled) return;
        setDocuments(docs);
        setCategories(savedCategories);
        setSort(parseLibrarySort(savedSort));
      })
      .catch((cause) => {
        if (!cancelled) onError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const refreshDocuments = async () => setDocuments(await services.library.list());
  const importDocuments = async (files: FileList | File[]): Promise<DocumentRecord | null> => {
    setImporting(true);
    onError("");
    try {
      let first: DocumentRecord | null = null;
      for (const file of Array.from(files)) {
        const saved = await services.library.importPaper(file);
        first ||= saved;
      }
      await refreshDocuments();
      return first;
    } catch (cause) {
      onError(String(cause));
      return null;
    } finally {
      setImporting(false);
    }
  };
  const toggleStar = async (document: DocumentRecord) => {
    try {
      await services.library.setStarred(document.id, !document.starred);
      await refreshDocuments();
    } catch (cause) {
      onError(String(cause));
    }
  };
  const removeDocument = async (document: DocumentRecord): Promise<boolean> => {
    if (!window.confirm(t("library.deleteConfirm", { title: document.title }))) return false;
    try {
      await services.library.remove(document.id);
      await refreshDocuments();
      return true;
    } catch (cause) {
      onError(String(cause));
      return false;
    }
  };
  const updateProgress = (id: string, page: number) => {
    setDocuments((current) =>
      current.map((item) => (item.id === id ? { ...item, currentPage: page } : item)),
    );
    void services.library.setProgress(id, page).catch((cause) => onError(String(cause)));
  };
  const changeSort = async (next: LibrarySort) => {
    if (savingSort) return;
    setSavingSort(true);
    try {
      await services.settings.set(LIBRARY_SORT_SETTING, next);
      setSort(next);
    } catch (cause) {
      onError(String(cause));
    } finally {
      setSavingSort(false);
    }
  };
  // Dialogs display their own errors, so create/move propagate service failures.
  const createCategory = async (name: string) => {
    const saved = await services.categories.create(name);
    setCategories(await services.categories.list());
    setQuery("");
    setFilter({ categoryId: saved.id });
  };
  const removeCategory = async (category: CategoryRecord) => {
    if (!window.confirm(t("categories.removeConfirm", { name: category.name }))) return;
    try {
      await services.categories.remove(category.id);
      const [nextCategories, nextDocuments] = await Promise.all([
        services.categories.list(),
        services.library.list(),
      ]);
      setCategories(nextCategories);
      setDocuments(nextDocuments);
      setFilter((current) =>
        typeof current === "object" && current.categoryId === category.id
          ? "uncategorized"
          : current,
      );
    } catch (cause) {
      onError(String(cause));
    }
  };
  const moveDocument = async (id: string, categoryId: string | null) => {
    await services.library.move(id, categoryId);
    await refreshDocuments();
  };

  const filterLabel =
    typeof filter === "object"
      ? categories.find((category) => category.id === filter.categoryId)?.name || t("nav.papers")
      : t(
          (
            {
              all: "nav.all",
              recent: "nav.recent",
              starred: "nav.starred",
              uncategorized: "nav.papers",
            } as const
          )[filter],
        );
  // All papers includes every category and favorite status.
  const visibleDocuments = sortDocuments(
    documents.filter(
      (document) =>
        (filter !== "starred" || document.starred) &&
        (filter !== "uncategorized" || !document.categoryId) &&
        (typeof filter !== "object" || document.categoryId === filter.categoryId) &&
        (filter !== "recent" || Date.now() / 1000 - document.updatedAt < 30 * 24 * 3600) &&
        `${document.title} ${document.fileName}`.toLowerCase().includes(query.toLowerCase()),
    ),
    sort,
    dateLocale(),
  );

  return {
    documents,
    categories,
    filter,
    setFilter,
    filterLabel,
    query,
    setQuery,
    sort,
    savingSort,
    importing,
    visibleDocuments,
    importDocuments,
    toggleStar,
    removeDocument,
    updateProgress,
    changeSort,
    createCategory,
    removeCategory,
    moveDocument,
  };
}
