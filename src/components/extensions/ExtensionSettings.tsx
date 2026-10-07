import { ExtensionConfiguration } from "./ExtensionConfiguration";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { extensionHost, extensionInstaller } from "../../application/extensions/runtime";
import type { InstallationPlan } from "../../application/extensions/installer";
import { readLocalPackage } from "../../infrastructure/extensions/local-package";
import type { ExtensionPackage } from "../../infrastructure/extensions/package";
import type { Label } from "../../sdk";
import { ui } from "../../sdk/ui/styles";
const label = (value: Label, language?: string) =>
  typeof value === "string" ? value : language === "en" ? value.en : value.zh;

export function ExtensionSettings() {
  const snapshot = useSyncExternalStore(extensionHost.subscribe, extensionHost.getSnapshot),
    { t, i18n } = useTranslation();
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [packages, setPackages] = useState<ExtensionPackage[]>([]);
  const [impact, setImpact] = useState<{
    id: string;
    kind: "disable" | "uninstall";
    affected: string[];
  } | null>(null);
  const input = useRef<HTMLInputElement>(null),
    inspection = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inspection.current?.abort();
    },
    [],
  );
  const plan: InstallationPlan | null = packages.length ? extensionInstaller.plan(packages) : null;
  const run = async (operation: () => Promise<void>, success?: string) => {
    setPending(true);
    setError("");
    setNotice("");
    try {
      await operation();
      if (success) setNotice(success);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };
  const change = (id: string, kind: "disable" | "uninstall") => {
    const affected = extensionHost.getDependents(id, kind === "disable");
    setImpact({ id, kind, affected });
  };
  return (
    <main data-ui="settings-main" className={ui.settingsPage}>
      <h1 className="mb-3 text-2xl">{t("extensions.title")}</h1>
      <p className="mb-4 text-xs text-muted">{t("extensions.description")}</p>
      <div className="mb-6 flex flex-wrap gap-3">
        <input
          ref={input}
          data-ui="extension-package-input"
          type="file"
          multiple
          accept=".cachx,.zip"
          hidden
          onChange={(event) => {
            const files = [...(event.target.files || [])];
            event.target.value = "";
            if (!files.length) return;
            void run(async () => {
              inspection.current?.abort();
              const controller = new AbortController();
              inspection.current = controller;
              const parsed: ExtensionPackage[] = [];
              for (const file of files)
                parsed.push(await readLocalPackage(file, controller.signal));
              if (new Set(parsed.map((pkg) => pkg.id)).size !== parsed.length)
                throw new Error(t("extensions.duplicatePackageVersions"));
              setPackages((previous) => [
                ...previous.filter((pkg) => !parsed.some((next) => next.id === pkg.id)),
                ...parsed,
              ]);
              setImpact(null);
            });
          }}
        />
        <button
          disabled={pending}
          className={ui.secondaryButton}
          onClick={() => input.current?.click()}
        >
          {t("extensions.installPackage")}
        </button>
        <button
          disabled={pending}
          className={ui.secondaryButton}
          onClick={() => {
            void run(() => extensionHost.restart(), t("extensions.restarted"));
          }}
        >
          {t("extensions.restartAll")}
        </button>
      </div>
      {error && (
        <p role="alert" className={ui.formError}>
          {t("extensions.operationFailed")} {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 text-xs text-muted">
          {notice}
        </p>
      )}
      {plan && (
        <section
          data-ui="extension-install-review"
          className="mb-6 rounded-lg border border-border p-5"
        >
          <h2 className="mb-3 text-sm font-bold">{t("extensions.review")}</h2>
          <p className="mb-3 text-xs text-muted">{t("extensions.localTrust")}</p>
          {plan.changes.map((item) => (
            <div key={item.id} className="mb-3 text-xs">
              <p className="font-bold">
                {item.id} · {item.previous ? `${item.previous} → ` : ""}
                {item.version} {item.downgrade && t("extensions.downgrade")}
              </p>
              <p className="mt-1 text-muted">
                {t("extensions.permissions")}:{" "}
                {item.capabilities.length
                  ? item.capabilities
                      .map((capability) => t(`extensions.capabilities.${capability}` as never))
                      .join(" / ")
                  : t("extensions.noPermissions")}
              </p>
              {packages.find((pkg) => pkg.id === item.id)?.manifest.extensionDependencies
                ?.length ? (
                <p className="mt-1 text-muted">
                  {t("extensions.dependencies")}:{" "}
                  {packages
                    .find((pkg) => pkg.id === item.id)!
                    .manifest.extensionDependencies!.join(", ")}
                </p>
              ) : null}
              {packages.find((pkg) => pkg.id === item.id)?.manifest.extensionPack?.length ? (
                <p className="mt-1 text-muted">
                  {t("extensions.pack")}:{" "}
                  {packages.find((pkg) => pkg.id === item.id)!.manifest.extensionPack!.join(", ")}
                </p>
              ) : null}
            </div>
          ))}
          {plan.missing.length > 0 && (
            <p role="alert" className={ui.formError}>
              {t("extensions.missingPackages", { ids: plan.missing.join(", ") })}
            </p>
          )}
          {plan.cycles.map((path, index) => (
            <p key={index} role="alert" className={ui.formError}>
              {t("extensions.cycle", { ids: path.join(" → ") })}
            </p>
          ))}
          {plan.blockedBuiltIns.length > 0 && (
            <p role="alert" className={ui.formError}>
              {t("extensions.cannotReplaceBuiltIn", { ids: plan.blockedBuiltIns.join(", ") })}
            </p>
          )}
          {plan.disabled.length > 0 && (
            <p className="mb-3 text-xs text-muted">
              {t("extensions.disabledDependencies", { ids: plan.disabled.join(", ") })}
            </p>
          )}
          {plan.restart.length > 0 && (
            <p className="mb-3 text-xs text-muted">
              {t("extensions.restartAffected", { ids: plan.restart.join(", ") })}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              data-ui="extension-confirm-install"
              disabled={
                pending ||
                !!(plan.missing.length || plan.cycles.length || plan.blockedBuiltIns.length)
              }
              className={ui.primaryButton}
              onClick={() => {
                void run(async () => {
                  await extensionInstaller.install(plan);
                  setPackages([]);
                }, t("extensions.installed"));
              }}
            >
              {t("extensions.confirmInstall")}
            </button>
            <button
              disabled={pending}
              className={ui.secondaryButton}
              onClick={() => input.current?.click()}
            >
              {t("extensions.addPackages")}
            </button>
            <button
              disabled={pending}
              className={ui.secondaryButton}
              onClick={() => setPackages([])}
            >
              {t("common.cancel")}
            </button>
          </div>
        </section>
      )}
      {impact && (
        <section
          data-ui="extension-impact-review"
          className="mb-6 rounded-lg border border-border p-5"
        >
          <h2 className="mb-3 text-sm font-bold">
            {t(
              impact.kind === "disable"
                ? "extensions.confirmDisable"
                : "extensions.confirmUninstall",
            )}
          </h2>
          <p className="mb-3 text-xs">{[...impact.affected, impact.id].join(", ")}</p>
          <p className="mb-3 text-xs text-muted">
            {t(
              impact.kind === "disable" ? "extensions.disableImpact" : "extensions.uninstallImpact",
            )}
          </p>
          {impact.kind === "uninstall" &&
          impact.affected.some(
            (id) => snapshot.extensions.find((item) => item.id === id)?.builtIn,
          ) ? (
            <p role="alert" className={ui.formError}>
              {t("extensions.builtInDependent")}
            </p>
          ) : (
            <button
              disabled={pending}
              className={ui.primaryButton}
              onClick={() => {
                void run(async () => {
                  if (impact.kind === "disable")
                    await extensionHost.setEnabled(impact.id, false, { cascade: true });
                  else await extensionHost.uninstall(impact.id, { cascade: true });
                  setImpact(null);
                });
              }}
            >
              {t("extensions.apply")}
            </button>
          )}
          <button
            disabled={pending}
            className={`${ui.secondaryButton} ml-3`}
            onClick={() => setImpact(null)}
          >
            {t("common.cancel")}
          </button>
        </section>
      )}
      {snapshot.extensions.map((item) => (
        <section
          key={item.id}
          data-extension-id={item.id}
          className="mb-4 rounded-lg border border-border p-5"
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="flex-1 text-sm font-bold">
              {label(item.manifest.displayName, i18n.resolvedLanguage)}
            </h2>
            {item.builtIn && <span className="text-xs text-muted">{t("extensions.builtIn")}</span>}
            <button
              className={ui.secondaryButton}
              disabled={pending}
              aria-pressed={item.enabled}
              onClick={() => {
                if (item.enabled && extensionHost.getDependents(item.id, true).length)
                  change(item.id, "disable");
                else {
                  void run(() => extensionHost.setEnabled(item.id, !item.enabled));
                }
              }}
            >
              {t(item.enabled ? "extensions.disable" : "extensions.enable")}
            </button>
            <button
              className={ui.secondaryButton}
              disabled={pending || !item.enabled}
              onClick={() => {
                void run(() => extensionHost.restart(item.id));
              }}
            >
              {t("extensions.restart")}
            </button>
            {!item.builtIn && (
              <button
                className={ui.secondaryButton}
                disabled={pending}
                onClick={() => change(item.id, "uninstall")}
              >
                {t("extensions.uninstall")}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs text-muted">
            {label(item.manifest.description, i18n.resolvedLanguage)}
          </p>
          <p className="mt-2 text-[10px] text-muted">
            {item.id} · {item.manifest.version} · {t(`extensions.status.${item.status}`)}
          </p>
          {!!item.manifest.extensionDependencies?.length && (
            <p className="mt-2 text-xs text-muted">
              {t("extensions.dependencies")}: {item.manifest.extensionDependencies.join(", ")}
            </p>
          )}
          {item.problem && (
            <p role="alert" className={ui.formError}>
              {t(`extensions.problems.${item.problem.kind}`, {
                ids: item.problem.path.join(" → "),
              })}
            </p>
          )}
          <ExtensionConfiguration
            owner={item.id}
            declarations={item.manifest.contributes?.configuration ?? []}
          />
          {item.error && (
            <p role="alert" className={ui.formError}>
              {item.error}
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
