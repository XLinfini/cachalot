import { useState } from "react";
import { FolderOpen, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CategoryRecord, DocumentRecord } from "../domain/records";
import { localizeMessage } from "../i18n/messages";
import { Modal } from "./ui/Modal";
import { cx, ui } from "../sdk/ui/styles";

export function CreateCategoryDialog({
  onCreate,
  onClose,
}: {
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={t("categories.create")} onClose={onClose} busy={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          void onCreate(name)
            .then(onClose)
            .catch((cause) => setError(String(cause)))
            .finally(() => setBusy(false));
        }}
      >
        <label className={ui.fieldLabel}>
          {t("categories.name")}
          <input
            autoFocus
            className={ui.fieldInput}
            value={name}
            placeholder={t("categories.namePlaceholder")}
            disabled={busy}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
          />
        </label>
        {error && (
          <p role="alert" className={cx(ui.formError, "mb-4")}>
            {localizeMessage(error)}
          </p>
        )}
        <div className={ui.settingsActions}>
          <button type="button" className={ui.secondaryButton} disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </button>
          <button className={ui.primaryButton} disabled={busy || !name.trim()}>
            {t(busy ? "categories.creating" : "categories.createSubmit")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function MoveCategoryDialog({
  document,
  categories,
  onMove,
  onClose,
}: {
  document: DocumentRecord;
  categories: CategoryRecord[];
  onMove: (categoryId: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState(document.categoryId || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const destinations = [{ id: "", name: t("nav.papers") }, ...categories];
  return (
    <Modal
      title={t("categories.moveTitle", { title: document.title })}
      onClose={onClose}
      busy={busy}
    >
      <fieldset className="mb-5 border-0 p-0" disabled={busy}>
        <legend className="mb-3 text-[11px] text-muted">{t("categories.destinations")}</legend>
        <div className="max-h-[280px] overflow-y-auto">
          {destinations.map((category) => (
            <label
              key={category.id}
              className="mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-[12px] hover:bg-brand-soft"
            >
              <input
                type="radio"
                name="category"
                value={category.id}
                checked={selected === category.id}
                onChange={() => setSelected(category.id)}
                className="accent-brand"
              />
              <FolderOpen size={16} className="flex-none text-muted" />
              <span className="min-w-0 flex-1 truncate" title={category.name}>
                {category.name}
              </span>
              {(document.categoryId || "") === category.id && (
                <span className="flex items-center gap-1 text-[10px] text-muted">
                  <Check size={12} />
                  {t("categories.current")}
                </span>
              )}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className={cx(ui.formError, "mb-4")}>
          {localizeMessage(error)}
        </p>
      )}
      <div className={ui.settingsActions}>
        <button className={ui.secondaryButton} disabled={busy} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button
          className={ui.primaryButton}
          disabled={busy || selected === (document.categoryId || "")}
          onClick={() => {
            setBusy(true);
            setError("");
            void onMove(selected || null)
              .then(onClose)
              .catch((cause) => setError(String(cause)))
              .finally(() => setBusy(false));
          }}
        >
          {t(busy ? "categories.moving" : "categories.moveSubmit")}
        </button>
      </div>
    </Modal>
  );
}
