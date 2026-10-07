import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx } from "../../sdk/ui/styles";
import { localizeMessage } from "../../i18n/messages";

/** Errors stay language-neutral until presentation, including provider details. */
export function AppNotice({
  message,
  onDismiss,
  contained = false,
}: {
  message: string;
  onDismiss: () => void;
  contained?: boolean;
}) {
  const { t } = useTranslation();
  if (!message) return null;
  return (
    <div
      className={cx(
        contained ? "absolute" : "fixed",
        "right-[18px] bottom-[18px] z-30 flex max-w-[460px] items-center gap-3 rounded-button bg-[#263b56] px-[15px] py-3 text-[11px] text-white shadow-[0_8px_24px_#18304d33]",
      )}
      role="alert"
    >
      <span className="max-h-[50vh] min-w-0 overflow-y-auto [overflow-wrap:anywhere] whitespace-pre-wrap">
        {localizeMessage(message)}
      </span>
      <button
        className="grid place-items-center border-0 bg-transparent text-white"
        onClick={onDismiss}
        aria-label={t("common.dismiss")}
      >
        <X size={16} />
      </button>
    </div>
  );
}
