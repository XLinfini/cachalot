import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelSelection, Provider } from "../domain/records";
import { chatModels, parseModelSelection } from "../domain/provider-models";
import { cx, ui } from "../sdk/ui/styles";

export default function DefaultModelSetting({
  providers,
  selection,
  onChange,
  onError,
}: {
  providers: Provider[];
  selection: ModelSelection | null;
  onChange: (selection: ModelSelection) => Promise<void>;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const choices = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => chatModels(provider).map((model) => ({ provider, model })));
  return (
    <div
      data-ui="default-model-setting"
      className="mb-6 grid grid-cols-[220px_minmax(0,1fr)] items-start gap-x-4 gap-y-2 max-compact:grid-cols-1"
    >
      <label htmlFor="default-chat-model" className="pt-2 text-[12px] font-semibold text-[#39526d]">
        {t("settings.defaultModel")}
      </label>
      <div>
        <select
          id="default-chat-model"
          className={cx(ui.fieldInput, "m-0 max-w-[480px]")}
          value={selection ? JSON.stringify(selection) : ""}
          disabled={busy || !choices.length}
          aria-describedby="default-chat-model-hint"
          onChange={async (event) => {
            const value = parseModelSelection(event.target.value);
            if (!value) return;
            setBusy(true);
            try {
              await onChange(value);
            } catch (cause) {
              onError(String(cause));
            } finally {
              setBusy(false);
            }
          }}
        >
          {!choices.length && <option value="">{t("settings.noDefaultModel")}</option>}
          {choices.map(({ provider, model }) => (
            <option
              key={JSON.stringify([provider.id, model.id])}
              value={JSON.stringify({ providerId: provider.id, modelId: model.id })}
            >
              {provider.name}/{model.id}
            </option>
          ))}
        </select>
        <p id="default-chat-model-hint" className="mt-2 mb-0 text-[11px] leading-5 text-muted">
          {t("settings.defaultModelHint")}
        </p>
      </div>
    </div>
  );
}
