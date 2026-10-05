import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ui } from "../../sdk/ui/styles";

/** Native modal semantics provide focus trapping, Escape and focus restoration.
 * Modal contents remain presentation code; storage belongs to the caller. */
export function Modal({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      aria-modal="true"
      className="m-auto max-h-[85vh] w-[420px] max-w-[calc(100vw-32px)] overflow-y-auto rounded-2xl border border-border bg-white p-0 text-ink shadow-surface backdrop:bg-[#1c2d46]/35"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="p-6">
        <header className="mb-5 flex items-start justify-between gap-3">
          <h2 className="min-w-0 text-[17px] font-bold break-words">{title}</h2>
          <button
            type="button"
            className={ui.iconButton}
            aria-label={t("common.close")}
            disabled={busy}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
