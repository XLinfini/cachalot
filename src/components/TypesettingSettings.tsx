import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import type { TypesettingSettings as Settings, TypesettingStatus } from "../domain/typesetting";
import { cx, ui } from "../sdk/ui/styles";

export default function TypesettingSettings() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TypesettingStatus | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [mode, setMode] = useState<"bundled" | "external">("bundled");
  const [bin, setBin] = useState("");
  const [packages, setPackages] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState("");
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const refresh = async () => {
    const next = await services.typesetting.getStatus();
    if (!mounted.current) return;
    setStatus(next);
    if (next.reason !== "desktop-only" && next.reason !== "unsupported-platform") {
      const configuration = await services.typesetting.getSettings();
      if (!mounted.current) return;
      setSettings(configuration);
      setMode(configuration.configuration.mode);
      setBin(configuration.configuration.binDirectory);
    }
  };
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((cause) => {
      if (mounted.current) setError(String(cause));
    });
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  const run = async (work: (signal: AbortSignal) => Promise<unknown>) => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setLog("");
    try {
      const result = await work(controller.signal);
      if (mounted.current) {
        setLog(typeof result === "string" ? result : t("typesetting.done"));
        await refresh();
      }
    } catch (cause) {
      if (mounted.current)
        setError(controller.signal.aborted ? t("typesetting.cancelled") : String(cause));
    } finally {
      request.current = null;
      if (mounted.current) setBusy(false);
    }
  };
  const supported =
    status && status.reason !== "desktop-only" && status.reason !== "unsupported-platform";
  return (
    <main data-ui="typesetting-settings" className={ui.settingsPage}>
      <div className={ui.eyebrowBlue}>{t("typesetting.eyebrow")}</div>
      <h1 className="mt-3 mb-2 text-[27px]">{t("typesetting.title")}</h1>
      <p className="mb-7 max-w-[840px] text-[12px] leading-6 text-muted">
        {t("typesetting.description")}
      </p>
      <section className={cx(ui.surface, "max-w-[840px] space-y-5 p-6")} aria-busy={busy}>
        <p role="status" className="text-[13px]">
          {status?.reason
            ? t(`typesetting.reasons.${status.reason}`)
            : status
              ? t(status.initialized ? "typesetting.ready" : "typesetting.pending")
              : t("typesetting.loading")}
        </p>
        {status?.runtimeId && (
          <p className="text-[11px] break-all text-muted">{status.runtimeId}</p>
        )}
        {supported && (
          <>
            <label className="block text-[12px] font-bold">
              {t("typesetting.engine")}
              <select
                className={cx(ui.fieldInput, "mt-2")}
                value={mode}
                disabled={busy}
                onChange={(event) => setMode(event.target.value as typeof mode)}
              >
                <option value="bundled">{t("typesetting.bundled")}</option>
                <option value="external">{t("typesetting.external")}</option>
              </select>
            </label>
            {mode === "external" && (
              <label className="block text-[12px] font-bold">
                {t("typesetting.binDirectory")}
                <input
                  className={cx(ui.fieldInput, "mt-2")}
                  value={bin}
                  disabled={busy}
                  onChange={(event) => setBin(event.target.value)}
                  placeholder="/path/to/texlive/2025/bin/x86_64-linux"
                />
              </label>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                className={ui.secondaryButton}
                disabled={busy || (mode === "external" && !bin.trim())}
                onClick={() =>
                  void run(() =>
                    services.typesetting.configure({
                      mode,
                      binDirectory: mode === "external" ? bin.trim() : "",
                    }),
                  )
                }
              >
                {t("typesetting.save")}
              </button>
              <button
                className={ui.primaryButton}
                disabled={busy || !status?.available}
                onClick={() => void run((signal) => services.typesetting.initialize(signal))}
              >
                {t("typesetting.initialize")}
              </button>
            </div>
            <p className="text-[11px] leading-6 text-muted">{t("typesetting.externalHint")}</p>
          </>
        )}
      </section>
      {supported && settings && (
        <section className={cx(ui.surface, "mt-5 max-w-[840px] space-y-4 p-6")}>
          <h2 className="text-[14px] font-bold">{t("typesetting.packagesTitle")}</h2>
          <p className="text-[11px] leading-6 text-muted">{t("typesetting.packagesHint")}</p>
          <label className="block text-[12px] font-bold">
            {t("typesetting.packageNames")}
            <input
              className={cx(ui.fieldInput, "mt-2")}
              disabled={busy || status?.mode !== "bundled" || !status.available}
              value={packages}
              onChange={(event) => setPackages(event.target.value)}
              placeholder="booktabs microtype"
            />
          </label>
          <button
            className={ui.secondaryButton}
            disabled={busy || !packages.trim() || status?.mode !== "bundled" || !status.available}
            onClick={() =>
              void run((signal) =>
                services.typesetting.installPackages(packages.trim().split(/[\s,]+/), signal),
              )
            }
          >
            {t("typesetting.install")}
          </button>
          <dl className="space-y-3 text-[11px] leading-5">
            {(["runtimeDirectory", "userTree", "templatesDirectory", "repository"] as const).map(
              (key) => (
                <div key={key}>
                  <dt className="font-bold">{t(`typesetting.${key}`)}</dt>
                  <dd className="break-all text-muted select-text">{settings[key]}</dd>
                </div>
              ),
            )}
          </dl>
        </section>
      )}
      {busy && (
        <button className={cx(ui.secondaryButton, "mt-5")} onClick={() => request.current?.abort()}>
          {t("common.cancel")}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-4 max-w-[840px] text-[12px] whitespace-pre-wrap text-red-700">
          {error}
        </p>
      )}
      {log && (
        <pre
          data-ui="typesetting-log"
          className="mt-5 max-h-72 max-w-[840px] overflow-auto rounded-md bg-canvas p-4 text-[11px] whitespace-pre-wrap select-text"
        >
          {log}
        </pre>
      )}
    </main>
  );
}
