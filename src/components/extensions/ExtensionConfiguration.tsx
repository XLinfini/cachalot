import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { extensionHost } from "../../application/extensions/runtime";
import type { ConfigurationDeclaration, ConfigurationValue, Label } from "../../sdk";
import { ui } from "../../sdk/ui/styles";
const label = (value: Label | undefined, language?: string) =>
  !value ? "" : typeof value === "string" ? value : language === "en" ? value.en : value.zh;
function fieldText(value: ConfigurationValue): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
export function ExtensionConfiguration({
  owner,
  declarations,
}: {
  owner: string;
  declarations: ConfigurationDeclaration[];
}) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const dirty = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    void Promise.all(
      declarations.map(
        async (declaration) =>
          [
            declaration.key,
            fieldText(await extensionHost.getConfigurationValue(owner, declaration.key)),
          ] as const,
      ),
    )
      .then((result) => {
        if (alive) setValues((current) => ({ ...Object.fromEntries(result), ...current }));
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    const subscription = extensionHost.onDidChangeConfiguration((change) => {
      if (change.owner === owner && !dirty.current.has(change.event.key))
        setValues((current) => ({ ...current, [change.event.key]: fieldText(change.event.value) }));
    });
    return () => {
      alive = false;
      subscription.dispose();
    };
  }, [owner, declarations]);
  if (!declarations.length) return null;
  const update = (key: string, value: string) => {
    dirty.current.add(key);
    setValues((current) => ({ ...current, [key]: value }));
    setNotice("");
  };
  const save = async (declaration: ConfigurationDeclaration, restore = false) => {
    setPending(declaration.key);
    setError("");
    setNotice("");
    try {
      const raw = values[declaration.key] ?? fieldText(declaration.default);
      const value = restore
        ? declaration.default
        : !declaration.type || declaration.type === "string"
          ? raw
          : JSON.parse(raw);
      await extensionHost.updateConfigurationValue(owner, declaration.key, value);
      dirty.current.delete(declaration.key);
      setValues((current) => ({ ...current, [declaration.key]: fieldText(value) }));
      setNotice(t("workbench.saved"));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="mt-4 border-t border-border pt-4" data-ui="extension-configuration">
      <h3 className="mb-3 text-xs font-bold">{t("workbench.configuration")}</h3>
      {declarations.map((declaration) => {
        const id = owner + "." + declaration.key;
        const value = values[declaration.key] ?? fieldText(declaration.default);
        return (
          <div key={declaration.key} className="mb-4">
            <label htmlFor={id} className="mb-1 block text-xs font-bold">
              {label(declaration.title, i18n.resolvedLanguage)}
            </label>
            {declaration.description && (
              <p className="mb-2 text-xs text-muted">
                {label(declaration.description, i18n.resolvedLanguage)}
              </p>
            )}
            {declaration.enum ? (
              <select
                id={id}
                className="rounded border border-border p-2 text-xs"
                value={JSON.stringify(
                  !declaration.type || declaration.type === "string" ? value : JSON.parse(value),
                )}
                onChange={(event) =>
                  update(declaration.key, fieldText(JSON.parse(event.target.value)))
                }
              >
                {declaration.enum.map((item) => (
                  <option key={JSON.stringify(item)} value={JSON.stringify(item)}>
                    {fieldText(item)}
                  </option>
                ))}
              </select>
            ) : declaration.type === "boolean" ? (
              <input
                id={id}
                type="checkbox"
                checked={value === "true"}
                onChange={(event) => update(declaration.key, String(event.target.checked))}
              />
            ) : declaration.type === "number" || declaration.type === "integer" ? (
              <input
                id={id}
                type="number"
                value={value}
                min={declaration.minimum}
                max={declaration.maximum}
                step={declaration.type === "integer" ? 1 : "any"}
                className="rounded border border-border p-2 text-xs"
                onChange={(event) => update(declaration.key, event.target.value)}
              />
            ) : (
              <textarea
                id={id}
                value={value}
                rows={declaration.type === "array" || declaration.type === "object" ? 4 : 2}
                className="w-full rounded border border-border p-2 text-xs"
                onChange={(event) => update(declaration.key, event.target.value)}
              />
            )}
            <div className="mt-2 flex gap-2">
              <button
                className={ui.secondaryButton}
                disabled={pending !== null}
                onClick={() => void save(declaration)}
              >
                {t("workbench.save")}
              </button>
              <button
                className={ui.secondaryButton}
                disabled={pending !== null}
                onClick={() => void save(declaration, true)}
              >
                {t("workbench.restore")}
              </button>
            </div>
          </div>
        );
      })}
      {error && (
        <p role="alert" className={ui.formError}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted">
          {notice}
        </p>
      )}
    </div>
  );
}
