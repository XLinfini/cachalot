import { useEffect, useState } from "react";
import { useExtensionTranslation } from "../../sdk/react";
import type { ExtensionContext } from "../../sdk";
import { message } from "../../sdk";
import { cx, ui, localizeMessage } from "../../sdk/react";
import { DEFAULT_TRANSLATION_PROMPT } from "./prompt";
export default function TranslationSettings({ context }: { context: ExtensionContext }) {
  const { t } = useExtensionTranslation(context);
  const [prompt, setPrompt] = useState(DEFAULT_TRANSLATION_PROMPT);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    void context.workspace
      .getConfiguration()
      .get("prompt")
      .then((value) => {
        if (alive) setPrompt(value);
      })
      .catch((error) => {
        if (alive) setNotice(String(error));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [context]);
  return (
    <main data-ui="settings-main" className={cx(ui.settingsPage, "max-w-[920px]")}>
      <div className={ui.eyebrowBlue}>{t("settings.translationEyebrow")}</div>
      <h1 className="mt-3 mb-2 text-[27px]">{t("settings.translationTitle")}</h1>
      <p className="mb-[33px] text-[12px] text-[#8b9caf]">{t("settings.translationDescription")}</p>
      <div className={cx(ui.surface, "p-6")}>
        <label className="mb-[10px] block text-[12px] font-bold" htmlFor="translation-prompt">
          {t("settings.prompt")}
        </label>
        <textarea
          className={cx(ui.fieldInput, "block resize-y leading-[1.8]")}
          id="translation-prompt"
          value={prompt}
          disabled={loading}
          onChange={(event) => setPrompt(event.target.value)}
          rows={12}
        />
        <div className={cx(ui.settingsActions, "mt-[14px]")}>
          <button
            className={ui.secondaryButton}
            disabled={loading}
            onClick={() => setPrompt(DEFAULT_TRANSLATION_PROMPT)}
          >
            {t("settings.restorePrompt")}
          </button>
          <button
            className={ui.primaryButton}
            disabled={loading}
            onClick={() =>
              void context.workspace
                .getConfiguration()
                .update("prompt", prompt)
                .then(() => setNotice(message("promptSaved")))
                .catch((cause: unknown) => setNotice(String(cause)))
            }
          >
            {t("settings.savePrompt")}
          </button>
        </div>
      </div>
      {notice && <p className={ui.settingsNotice}>{localizeMessage(notice)}</p>}
    </main>
  );
}
