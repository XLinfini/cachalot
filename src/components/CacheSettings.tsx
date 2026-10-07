import { useEffect, useRef, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import { CACHE_KINDS, type CacheKind, type CacheUsage } from "../domain/cache";
import { localizeMessage } from "../i18n/messages";
import { cx, ui } from "../sdk/ui/styles";
import { Modal } from "./ui/Modal";

/** Presentation only: sizes and deletion scope come from the cache service. */
export default function CacheSettings() {
  const { t, i18n } = useTranslation();
  const [usage, setUsage] = useState<CacheUsage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<CacheKind | null>(null);
  const [error, setError] = useState("");
  const [cleared, setCleared] = useState<CacheKind | null>(null);
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = async () => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await services.cache.usage();
      if (mounted.current) setUsage(next);
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const clear = async (kind: CacheKind) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setCleared(null);
    try {
      await services.cache.clear(kind);
      if (mounted.current) {
        setConfirmation(null);
        setCleared(kind);
        setUsage(
          (current) =>
            current?.map((row) =>
              row.kind === kind ? { ...row, bytes: 0, entries: 0, candidates: 0 } : row,
            ) || null,
        );
      }
      const next = await services.cache.usage();
      if (mounted.current) setUsage(next);
    } catch (cause) {
      if (mounted.current) setError(String(cause));
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const size = (bytes: number) => {
    const units = ["B", "KiB", "MiB", "GiB"];
    const index = Math.min(3, bytes > 0 ? Math.floor(Math.log(bytes) / Math.log(1024)) : 0);
    return `${new Intl.NumberFormat(i18n.resolvedLanguage, { maximumFractionDigits: 1 }).format(bytes / 1024 ** index)} ${units[index]}`;
  };
  return (
    <main data-ui="cache-settings" className={ui.settingsPage}>
      <div className={ui.eyebrowBlue}>{t("cache.eyebrow")}</div>
      <div className="mt-3 mb-2 flex max-w-[840px] items-center justify-between gap-5">
        <h1 className="text-[27px]">{t("cache.title")}</h1>
        <button className={ui.secondaryButton} disabled={busy} onClick={() => void refresh()}>
          <RefreshCw size={16} className={busy ? "animate-spin" : ""} />
          {t("cache.refresh")}
        </button>
      </div>
      <p className="mb-7 max-w-[840px] text-[12px] leading-6 text-muted">
        {t("cache.description")}
      </p>
      <section className={cx(ui.surface, "max-w-[840px] overflow-hidden")} aria-busy={busy}>
        <div className="flex items-center justify-between gap-5 bg-canvas px-6 py-5">
          <div>
            <h2 className="text-[14px] font-bold">{t("cache.total")}</h2>
            <p className="mt-1 text-[11px] text-muted">
              {t("cache.groups", { count: CACHE_KINDS.length })}
            </p>
          </div>
          <strong data-ui="cache-total" className="text-[24px] text-brand">
            {usage ? size(usage.reduce((sum, row) => sum + row.bytes, 0)) : "—"}
          </strong>
        </div>
        {CACHE_KINDS.map((kind) => {
          const row = usage?.find((row) => row.kind === kind);
          return (
            <div
              key={kind}
              data-cache-kind={kind}
              className="flex items-center gap-5 border-t border-border px-6 py-5"
            >
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-bold">{t(`cache.kinds.${kind}.name`)}</h3>
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  {t(`cache.kinds.${kind}.description`)}
                </p>
                {row && (
                  <p data-ui="cache-count" className="mt-2 text-[11px] text-brand">
                    {t("cache.entries", { count: row.entries })}
                    {kind === "formulas" &&
                      ` · ${t("cache.candidates", { count: row.candidates })}`}
                  </p>
                )}
              </div>
              <span
                data-ui="cache-size"
                className="min-w-[85px] text-right text-[13px] whitespace-nowrap"
              >
                {row ? size(row.bytes) : "—"}
              </span>
              <button
                className={ui.secondaryButton}
                disabled={busy || !row?.entries}
                aria-label={t("cache.clearKind", { name: t(`cache.kinds.${kind}.name`) })}
                onClick={() => {
                  setError("");
                  setConfirmation(kind);
                }}
              >
                <Trash2 size={15} />
                {t("cache.clear")}
              </button>
            </div>
          );
        })}
      </section>
      <p className="mt-5 max-w-[840px] text-[11px] leading-6 text-muted">
        {t("cache.measurement")}
      </p>
      <p className="mt-2 max-w-[840px] text-[11px] leading-6 text-muted">{t("cache.runtime")}</p>
      {error && (
        <p role="alert" className="mt-4 text-[12px] whitespace-pre-wrap text-red-700">
          {t("cache.failed")} {localizeMessage(error)}
        </p>
      )}
      {cleared && (
        <p role="status" className={ui.settingsNotice}>
          {t("cache.cleared", { name: t(`cache.kinds.${cleared}.name`) })}
        </p>
      )}
      {confirmation && (
        <Modal
          title={t("cache.clearKind", { name: t(`cache.kinds.${confirmation}.name`) })}
          busy={busy}
          onClose={() => setConfirmation(null)}
        >
          <p className="text-[12px] leading-6 text-muted">
            {t(`cache.kinds.${confirmation}.effect`)}
          </p>
          <p className="mt-3 text-[12px] leading-6 text-muted">{t("cache.scope")}</p>
          {error && (
            <p role="alert" className="mt-3 text-[12px] whitespace-pre-wrap text-red-700">
              {t("cache.failed")} {localizeMessage(error)}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-3">
            <button
              className={ui.secondaryButton}
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              {t("common.cancel")}
            </button>
            <button
              className={ui.primaryButton}
              disabled={busy}
              onClick={() => void clear(confirmation)}
            >
              {t(busy ? "cache.clearing" : "cache.clear")}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
