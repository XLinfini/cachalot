import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, Minimize2, Settings2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx, ui } from "../sdk/ui/styles";

/** The native top layer keeps focus inside settings and restores it on close. */
export function SettingsDialog({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>('[data-ui="settings-search"]')?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      data-ui="settings-dialog"
      aria-label={t("common.settings")}
      aria-modal="true"
      className={cx(
        "fixed inset-0 m-auto overflow-hidden rounded-xl border border-border bg-white p-0 text-ink shadow-[0_24px_80px_#172b4533,0_4px_16px_#172b4514] backdrop:bg-[#172b45]/20 open:flex open:flex-col",
        expanded
          ? "h-[calc(100dvh-32px)] max-h-none w-[calc(100vw-32px)] max-w-none"
          : "h-[780px] max-h-[calc(100dvh-64px)] w-[1180px] max-w-[calc(100vw-64px)] max-compact:max-h-[calc(100dvh-32px)] max-compact:max-w-[calc(100vw-32px)]",
      )}
      onCancel={(event) => {
        // React propagates a nested dialog's cancel event to its ancestors.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
    >
      <header className="flex h-[50px] flex-none items-center justify-between border-b border-border bg-canvas pr-3">
        <div className="flex h-full items-center gap-2.5 border-b-2 border-brand bg-white px-6 text-[13px] font-semibold">
          <Settings2 size={17} className="text-brand" aria-hidden="true" />
          <h1 className="m-0 text-[13px]">{t("common.settings")}</h1>
        </div>
        <div className="flex items-center gap-1">
          <span className="mr-4 text-[11px] tracking-wide text-muted">Cachalot</span>
          <button
            type="button"
            className={ui.iconButton}
            aria-label={t(expanded ? "settings.restoreWindow" : "settings.expandWindow")}
            title={t(expanded ? "settings.restoreWindow" : "settings.expandWindow")}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className={ui.iconButton}
            aria-label={t("settings.close")}
            title={t("settings.close")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </dialog>
  );
}
