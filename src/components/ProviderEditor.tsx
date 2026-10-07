import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CircleHelp, Layers3, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import type { FormulaOcrProtocol, ModelInfo, Provider, ProviderInput } from "../domain/records";
import { addedModels } from "../domain/provider-models";
import { apiEndpoint } from "../domain/api-endpoint";
import { message } from "../domain/messages";
import { visionKey } from "../application/model-catalog";
import { localizeMessage } from "../i18n/messages";
import { cx, ui } from "../sdk/ui/styles";
import ApiKeyField from "./ApiKeyField";

interface Props {
  purpose: "llm" | "ocr";
  providers: Provider[];
  activeProviderId: string | null;
  onProvidersChange: (providers: Provider[]) => void;
  headerSlot?: ReactNode;
  onError: (message: string) => void;
  embedded?: boolean;
}

/** Shared form and credential controls; each settings area owns its providers
 * and model list. Existing OCR-only providers are classified on read. */
export default function ProviderEditor({
  purpose,
  providers,
  activeProviderId,
  onProvidersChange,
  headerSlot,
  onError,
  embedded = false,
}: Props) {
  const { t, i18n } = useTranslation();
  const adapters = services.ocr.adapters();
  const presets = services.ocr.presets();
  const label = (value: { zh: string; en: string }) =>
    value[i18n.resolvedLanguage === "en" ? "en" : "zh"];
  const visibleProviders = providers.filter((provider) =>
    purpose === "llm"
      ? provider.purpose !== "ocr"
      : provider.purpose === "ocr" || addedModels(provider).some((model) => !!model.formulaOcr),
  );
  const Element = embedded ? "section" : "main";
  const [modelsError, setModelsError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderInput | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const modelDrawerRef = useRef<HTMLDialogElement>(null);
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const [providerQuery, setProviderQuery] = useState("");
  const [modelQuery, setModelQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [manualModelId, setManualModelId] = useState("");
  const [imageOverrides, setImageOverrides] = useState<Record<string, boolean>>({});
  const draftModels = draft ? addedModels(draft) : [];
  const shownModels =
    purpose === "ocr"
      ? draftModels.filter((model) => draft?.purpose === "ocr" || !!model.formulaOcr)
      : draftModels.filter((model) => !model.formulaOcr || model.formulaOcr === "vision-llm");
  const matchingProviders = visibleProviders.filter((provider) =>
    `${provider.name} ${provider.baseUrl}`
      .toLocaleLowerCase()
      .includes(providerQuery.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (!models) return;
    const dialog = modelDrawerRef.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      modelTriggerRef.current?.focus();
    };
  }, [models !== null]);
  const draftProtocol = draftModels.find((m) => m.id === draft?.modelId)?.formulaOcr;
  const draftAdapter = adapters.find((adapter) => adapter.id === draftProtocol);
  const requestUrls = (() => {
    if (!draft) return null;
    try {
      return {
        models: apiEndpoint(draft.baseUrl, "models"),
        chat: apiEndpoint(draft.baseUrl, "chat/completions"),
        ocr:
          purpose === "ocr" && draftProtocol
            ? services.ocr.endpoint(draftProtocol, draft.baseUrl)
            : undefined,
      };
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    // A newly created provider has no persisted row until Save is pressed.
    if (selectedId && draft?.id === selectedId && !providers.some((item) => item.id === selectedId))
      return;
    const id = visibleProviders.some((item) => item.id === selectedId)
      ? selectedId
      : visibleProviders[0]?.id || null;
    if (!id) return;
    // The selected provider effect runs once more after setting selectedId.
    // Do not overwrite edits made while that follow-up render is pending.
    if (selectedId === id && draft?.id === id) return;
    const provider = visibleProviders.find((item) => item.id === id);
    if (!provider) return;
    setSelectedId(id);
    setDraft({ ...provider, apiKey: "" });
  }, [providers, selectedId, purpose]);

  useEffect(() => {
    setManualModelId("");
    setImageOverrides({});
  }, [draft?.id]);

  const createProvider = () => {
    const id = crypto.randomUUID();
    setSelectedId(id);
    setDraft({
      id,
      purpose,
      name: t(purpose === "ocr" ? "ocr.customProvider" : "settings.customProvider"),
      baseUrl: "https://api.example.com/v1",
      modelId: "",
      enabled: true,
      apiKey: "",
      addedModels: [],
    });
    setNotice(message("providerDraft"));
  };

  const createPreset = (presetId: string) => {
    const draft = services.ocr.createPreset(presetId);
    setSelectedId(draft.id);
    setDraft(draft);
    setNotice(message("providerDraft"));
  };
  const setOcrProfile = (modelId: string, protocol: string) => {
    if (!draft || !modelId.trim()) return;
    const current = draftModels.find((m) => m.id === modelId) || { id: modelId.trim() };
    const { formulaOcr: _old, ...base } = current;
    const model: ModelInfo = {
      ...base,
      ...(protocol ? { formulaOcr: protocol as FormulaOcrProtocol } : {}),
    };
    setDraft({ ...draft, addedModels: [...draftModels.filter((m) => m.id !== model.id), model] });
  };
  const profileOptions = (current?: string) => (
    <>
      <option value="">{t("ocr.profileNone")}</option>
      {adapters.map((adapter) => (
        <option key={adapter.id} value={adapter.id}>
          {label(adapter.label)}
        </option>
      ))}
      {current && !adapters.some((adapter) => adapter.id === current) && (
        <option value={current}>{t("ocr.profileUnavailable", { adapter: current })}</option>
      )}
    </>
  );

  const changeModelEnabled = async (model: ModelInfo, enabled: boolean) => {
    if (!draft) return;
    const providerId = draft.id;
    const saved = providers.find((provider) => provider.id === providerId);
    if (!saved || !addedModels(saved).some((item) => item.id === model.id)) {
      setDraft({
        ...draft,
        addedModels: draftModels.map((item) =>
          item.id === model.id ? { ...item, enabled } : item,
        ),
      });
      return;
    }
    setBusy(true);
    try {
      const updated = await services.providers.setModelEnabled(providerId, model.id, enabled);
      onProvidersChange(
        providers.map((provider) => (provider.id === providerId ? updated : provider)),
      );
      setDraft((current) =>
        current?.id === providerId
          ? {
              ...current,
              enabled: true,
              addedModels: addedModels(current).map((item) =>
                item.id === model.id
                  ? { ...item, enabled }
                  : { ...item, enabled: item.enabled ?? current.enabled },
              ),
            }
          : current,
      );
    } catch (cause) {
      onError(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleAddedModel = (model: ModelInfo) => {
    setDraft((current) => {
      if (!current) return current;
      const models = addedModels(current);
      const next = models.some((item) => item.id === model.id)
        ? models.filter((item) => item.id !== model.id)
        : [
            ...models,
            purpose === "ocr" && !model.formulaOcr
              ? { ...model, formulaOcr: draftProtocol || "formula-chat" }
              : model,
          ];
      return {
        ...current,
        addedModels: next,
        modelId: next.some((item) => item.id === current.modelId)
          ? current.modelId
          : next[0]?.id || "",
      };
    });
  };

  const save = async (): Promise<Provider | null> => {
    if (!draft) return null;
    setBusy(true);
    try {
      const saved = await services.providers.save({ ...draft, purpose: draft.purpose || purpose });
      for (const model of addedModels(saved)) {
        const key = visionKey(saved.id, model.id);
        if (key in imageOverrides) await services.settings.set(key, String(imageOverrides[key]));
      }
      onProvidersChange([saved, ...providers.filter((item) => item.id !== saved.id)]);
      setDraft({ ...saved, apiKey: "" });
      setNotice(message("providerSaved"));
      return saved;
    } catch (cause) {
      onError(String(cause));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const fetchModels = async () => {
    setModelsError("");
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      setModels(await services.providers.listModels(saved.id, draftProtocol));
      setNotice("");
    } catch (cause) {
      setModels([]);
      setModelsError(String(cause));
      setNotice("");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    const saved = await save();
    if (!saved) return;
    setBusy(true);
    try {
      setNotice(
        purpose === "ocr"
          ? await services.ocr.test(saved)
          : await services.providers.test(saved.id),
      );
    } catch (cause) {
      setNotice(String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!draft || !providers.some((item) => item.id === draft.id)) return;
    if (!window.confirm(t("settings.deleteProviderConfirm", { name: draft.name }))) return;
    try {
      await services.providers.remove(draft.id);
      onProvidersChange(providers.filter((item) => item.id !== draft.id));
      setSelectedId(null);
      setDraft(null);
    } catch (cause) {
      onError(String(cause));
    }
  };

  return (
    <>
      <Element
        data-ui={purpose === "ocr" ? "ocr-provider-editor" : "settings-main"}
        id={purpose === "ocr" ? "ocr-provider-editor" : undefined}
        className={embedded ? "mt-10" : ui.settingsPage}
      >
        <div className={ui.eyebrowBlue}>
          {t(purpose === "ocr" ? "ocr.providersEyebrow" : "settings.providersEyebrow")}
        </div>
        <h2 className="mt-3 mb-2 text-[27px]">
          {t(purpose === "ocr" ? "ocr.providersTitle" : "settings.providersTitle")}
        </h2>
        <p className="mb-[33px] text-[12px] text-[#8b9caf]">
          {t(purpose === "ocr" ? "ocr.providersDescription" : "settings.providersDescription")}
        </p>
        {headerSlot}
        <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-4 max-compact:grid-cols-1">
          <section
            className={cx(
              ui.surface,
              "min-h-[300px] self-start px-[13px] py-[18px] max-compact:min-h-0",
            )}
          >
            <div className="flex items-center justify-between px-[5px] pb-4 [&>span]:text-[10px] [&>span]:text-[#9cabbc] [&>strong]:text-[12px]">
              <strong>{t("settings.provider")}</strong>
              <span>{t("common.items", { count: visibleProviders.length })}</span>
            </div>
            <label className={cx(ui.searchBox, "h-[34px]")}>
              <Search size={16} />
              <input
                className={ui.searchInput}
                placeholder={t("settings.searchProviders")}
                aria-label={t("settings.searchProviders")}
                value={providerQuery}
                onChange={(event) => setProviderQuery(event.target.value)}
              />
            </label>
            <div className={cx(ui.eyebrow, "px-[7px] pt-5 pb-[10px]")}>{t("settings.custom")}</div>
            {matchingProviders.map((item) => (
              <button
                key={item.id}
                aria-pressed={item.id === selectedId}
                className="flex w-full items-center gap-[9px] rounded-lg border border-transparent bg-transparent px-[7px] py-[9px] text-left hover:border-[#dbe9fb] hover:bg-[#eff5fe] aria-pressed:border-[#dbe9fb] aria-pressed:bg-[#eff5fe]"
                onClick={() => {
                  setSelectedId(item.id);
                  setDraft({ ...item, apiKey: "" });
                  setNotice("");
                }}
              >
                <span
                  className={cx(ui.avatar, "size-[31px] bg-[#e6effb] text-[13px] text-[#3a73bc]")}
                >
                  {item.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-[11px] text-[#39526d]">{item.name}</strong>
                  <small className="mt-1 block truncate text-[9px] text-subtle">
                    {item.baseUrl}
                  </small>
                </span>
                {item.id === activeProviderId && (
                  <span
                    className="size-[6px] flex-none rounded-full bg-[#3e80d1]"
                    title={t("settings.current")}
                  />
                )}
              </button>
            ))}
            {providerQuery && !matchingProviders.length && (
              <p className="px-2 py-3 text-[11px] text-muted">{t("settings.noProviders")}</p>
            )}
            <button
              className="mt-[11px] flex w-full items-center gap-[7px] rounded-lg border border-dashed border-[#c9d9ec] bg-[#f9fbfe] p-[9px] text-[11px] text-[#3b78c4]"
              onClick={createProvider}
            >
              <Plus size={17} />
              {t("settings.addProvider")}
            </button>
            {purpose === "ocr" &&
              presets.map((preset) => (
                <button
                  key={preset.id}
                  data-ui={`add-${preset.id}`}
                  data-ocr-preset={preset.id}
                  className="mt-2 w-full rounded-lg border border-[#c9d9ec] bg-white p-[9px] text-[11px] text-brand"
                  onClick={() => createPreset(preset.id)}
                >
                  {label(preset.buttonLabel)}
                </button>
              ))}
          </section>
          <section className={cx(ui.surface, "overflow-hidden")}>
            {draft ? (
              <>
                <div className="flex items-center gap-[11px] border-b border-[#e8edf4] px-[23px] py-5 [&_h2]:mb-1 [&_h2]:text-[15px] [&_p]:m-0 [&_p]:text-[10px] [&_p]:text-[#a0aebe] [&>div]:flex-1">
                  <span
                    className={cx(ui.avatar, "size-[42px] bg-[#e6effb] text-[18px] text-[#3a73bc]")}
                  >
                    {draft.name.slice(0, 1).toUpperCase()}
                  </span>
                  <div>
                    <h2>{draft.name}</h2>
                    <p>
                      {purpose === "ocr" && draftAdapter
                        ? label(draftAdapter.label)
                        : t("settings.compatibleApi")}
                    </p>
                  </div>
                </div>
                <div className="px-[23px] py-[22px]">
                  <h3 className="mb-[5px] text-[12px]">{t("settings.connection")}</h3>
                  <p className="mb-5 text-[10px] text-[#9caabb]">{t("settings.connectionHint")}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <label className={ui.fieldLabel}>
                      {t("settings.providerName")}
                      <input
                        className={cx(ui.fieldInput, "block")}
                        value={draft.name}
                        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      />
                    </label>
                    <label className={ui.fieldLabel}>
                      {t("settings.apiUrl")}
                      <input
                        className={cx(ui.fieldInput, "block")}
                        value={draft.baseUrl}
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>
                  </div>
                  <div
                    data-ui="api-url-preview"
                    aria-live="polite"
                    className="mt-3 rounded-lg bg-[#f7fafd] px-3 py-[10px] text-[10px] leading-[1.7] text-[#7890aa]"
                  >
                    <p className="mb-1 font-semibold text-[#607590]">{t("settings.requestUrls")}</p>
                    {purpose === "ocr" && draftProtocol && !draftAdapter ? (
                      <p>{t("ocr.profileUnavailable", { adapter: draftProtocol })}</p>
                    ) : purpose === "ocr" && requestUrls?.ocr ? (
                      <>
                        <p data-ui="ocr-endpoint" className="font-mono break-all">
                          {requestUrls.ocr}
                        </p>
                        {draftAdapter?.description && <p>{label(draftAdapter.description)}</p>}
                      </>
                    ) : requestUrls ? (
                      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                        <dt>{t("settings.modelsEndpoint")}</dt>
                        <dd
                          data-ui="models-endpoint"
                          className="font-mono break-all text-[#456487]"
                        >
                          {requestUrls.models}
                        </dd>
                        <dt>
                          {t(purpose === "ocr" ? "ocr.chatEndpoint" : "settings.chatEndpoint")}
                        </dt>
                        <dd data-ui="chat-endpoint" className="font-mono break-all text-[#456487]">
                          {requestUrls.chat}
                        </dd>
                      </dl>
                    ) : (
                      <p>{t("messages.invalidApiUrl")}</p>
                    )}
                  </div>
                  <ApiKeyField
                    key={draft.id}
                    provider={providers.find((item) => item.id === draft.id)}
                    value={draft.apiKey || ""}
                    onChange={(apiKey) => setDraft({ ...draft, apiKey })}
                    onError={onError}
                  />
                  {purpose === "ocr" && (
                    <label className={ui.fieldLabel}>
                      {t("settings.modelId")}
                      <input
                        className={cx(ui.fieldInput, "block")}
                        value={draft.modelId}
                        onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
                        placeholder={t("settings.modelPlaceholder")}
                      />
                    </label>
                  )}
                  {purpose === "ocr" && (
                    <>
                      <label className={ui.fieldLabel} htmlFor="default-ocr-profile">
                        {t("ocr.profile")}
                      </label>
                      <select
                        id="default-ocr-profile"
                        className={cx(ui.fieldInput, "mb-3")}
                        value={draftProtocol || ""}
                        disabled={!draft.modelId.trim()}
                        onChange={(e) => setOcrProfile(draft.modelId, e.target.value)}
                      >
                        {profileOptions(draftProtocol)}
                      </select>
                      {draftProtocol && (
                        <p className="text-[10px] leading-5 text-muted">{t("ocr.testHint")}</p>
                      )}
                    </>
                  )}
                  <div className={ui.settingsActions}>
                    <button
                      className="mr-auto border-0 bg-transparent text-[#b3a2a9] hover:text-[#bd4654]"
                      onClick={() => void remove()}
                      title={t("settings.deleteProvider")}
                    >
                      <Trash2 size={17} />
                    </button>
                    <button
                      className={ui.secondaryButton}
                      disabled={busy}
                      onClick={() => void test()}
                    >
                      {t("settings.testConnection")}
                    </button>
                    <button
                      className={ui.primaryButton}
                      disabled={busy}
                      onClick={() => void save()}
                    >
                      {t("common.save")}
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-[#e8edf4] px-[23px] py-[18px] [&_h3]:mb-[5px] [&_h3]:text-[12px] [&_p]:m-0 [&_p]:text-[10px] [&_p]:text-[#9caabb]">
                  <div>
                    <h3>{t("settings.addedModels")}</h3>
                    <p>{t("settings.selectedModels", { count: shownModels.length })}</p>
                    <p className="mt-1!">{t("settings.modelEnabledHint")}</p>
                  </div>
                  <button
                    ref={modelTriggerRef}
                    className={ui.primaryButton}
                    disabled={busy}
                    onClick={() => void fetchModels()}
                  >
                    <Plus size={16} />
                    {t("settings.fetchModels")}
                  </button>
                </div>
                <div data-ui="added-models" className="mx-[23px] mb-[22px] space-y-2">
                  {shownModels.map((model) => (
                    <div
                      key={model.id}
                      data-ui="added-model"
                      data-model-id={model.id}
                      className="flex items-center gap-2 rounded-[7px] border border-[#e7eef7] bg-[#f7fafd] p-[10px] text-[11px] text-[#7890aa]"
                    >
                      <label className="relative inline-flex flex-none cursor-pointer">
                        <input
                          className="peer sr-only"
                          aria-label={t("settings.modelEnabled", { model: model.id })}
                          type="checkbox"
                          role="switch"
                          checked={model.enabled ?? draft.enabled}
                          disabled={busy}
                          onChange={(event) => void changeModelEnabled(model, event.target.checked)}
                        />
                        <span className="relative block h-5 w-[35px] rounded-[14px] bg-[#c8d4e1] peer-checked:bg-[#3679d2] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-disabled:opacity-50 peer-checked:[&>span]:translate-x-[15px]">
                          <span className="absolute top-[3px] left-[3px] size-[14px] rounded-full bg-white transition-transform duration-150" />
                        </span>
                      </label>
                      <span className="min-w-0 flex-1 break-all">{model.id}</span>
                      {purpose === "ocr" && (
                        <select
                          data-ui="model-ocr-profile"
                          aria-label={t("ocr.modelProfile", { model: model.id })}
                          className="max-w-[170px] rounded border border-border bg-white p-1 text-[10px]"
                          value={model.formulaOcr || ""}
                          onChange={(e) => setOcrProfile(model.id, e.target.value)}
                        >
                          {profileOptions(model.formulaOcr)}
                        </select>
                      )}
                      {purpose === "llm" ? (
                        <ModelImageCapability
                          provider={{ ...draft, hasKey: false }}
                          model={model}
                          value={imageOverrides[visionKey(draft.id, model.id)]}
                          onChange={(value) =>
                            setImageOverrides((current) => ({
                              ...current,
                              [visionKey(draft.id, model.id)]: value,
                            }))
                          }
                          onError={onError}
                        />
                      ) : (
                        <button
                          type="button"
                          className="flex-none border-0 bg-transparent text-[10px] text-[#3477c8]"
                          aria-label={t("ocr.editModel", { model: model.id })}
                          onClick={() => setDraft({ ...draft, modelId: model.id })}
                        >
                          {t("common.edit")}
                        </button>
                      )}
                      <button
                        type="button"
                        className={ui.iconButton}
                        aria-label={t("settings.removeModel", { model: model.id })}
                        onClick={() => toggleAddedModel(model)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  {!shownModels.length && (
                    <p className="text-[11px] text-subtle">
                      {t(purpose === "ocr" ? "ocr.manualModel" : "settings.manualModel")}
                    </p>
                  )}
                  {purpose === "llm" && (
                    <div className="flex items-end gap-2 pt-2">
                      <label className={cx(ui.fieldLabel, "min-w-0 flex-1")}>
                        {t("settings.modelId")}
                        <input
                          className={cx(ui.fieldInput, "mb-0 block")}
                          value={manualModelId}
                          onChange={(event) => setManualModelId(event.target.value)}
                          placeholder={t("settings.modelPlaceholder")}
                        />
                      </label>
                      <button
                        type="button"
                        className={ui.secondaryButton}
                        disabled={
                          !manualModelId.trim() ||
                          draftModels.some((model) => model.id === manualModelId.trim())
                        }
                        onClick={() => {
                          toggleAddedModel({ id: manualModelId.trim() });
                          setManualModelId("");
                        }}
                      >
                        <Plus size={16} />
                        {t("settings.addModel")}
                      </button>
                    </div>
                  )}
                </div>
                {notice && (
                  <p
                    className={cx(
                      ui.settingsNotice,
                      "[overflow-wrap:anywhere] whitespace-pre-wrap",
                    )}
                  >
                    {localizeMessage(notice)}
                  </p>
                )}
              </>
            ) : (
              <div className="flex h-[360px] flex-col items-center justify-center text-center text-[#86a2c3] [&>p]:my-[17px] [&>p]:max-w-[230px] [&>p]:text-[11px] [&>p]:leading-[1.6]">
                <CircleHelp size={26} />
                <p>{t(purpose === "ocr" ? "ocr.addHint" : "settings.addHint")}</p>
                <button className={ui.primaryButton} onClick={createProvider}>
                  {t("settings.addProvider")}
                </button>
              </div>
            )}
          </section>
        </div>
      </Element>
      {models && (
        <dialog
          ref={modelDrawerRef}
          aria-label={t("settings.chooseModel")}
          aria-modal="true"
          className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[420px] max-w-[calc(100vw-32px)] overflow-hidden border-0 bg-white p-0 text-ink shadow-[-15px_0_45px_#10254433] backdrop:bg-[#1c2b42]/35"
          onCancel={(event) => {
            event.preventDefault();
            setModels(null);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setModels(null);
          }}
        >
          <aside
            data-ui="model-drawer"
            className="flex h-full w-full flex-col bg-white px-[22px] py-[26px]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-[27px] flex items-center gap-[10px] [&_h2]:mt-1 [&_h2]:mb-0 [&_h2]:text-[17px] [&_small]:text-[9px] [&_small]:tracking-[.12em] [&_small]:text-[#89a0b8] [&>div]:flex-1">
              <span className="grid size-[36px] place-items-center rounded-button bg-[#eaf2fd] text-[#427ed1]">
                <Layers3 size={20} />
              </span>
              <div>
                <small>{t("settings.modelEyebrow")}</small>
                <h2>{t("settings.chooseModel")}</h2>
              </div>
              <button
                className={ui.iconButton}
                onClick={() => setModels(null)}
                aria-label={t("common.close")}
              >
                <X size={20} />
              </button>
            </div>
            <label className={cx(ui.searchBox, "h-[34px]")}>
              <Search size={16} />
              <input
                className={ui.searchInput}
                value={modelQuery}
                onChange={(event) => setModelQuery(event.target.value)}
                placeholder={t("settings.searchModels")}
              />
            </label>
            <div className="mt-[26px] mb-[10px] flex justify-between text-[11px] font-bold [&>span]:font-normal [&>span]:text-[#9aaaba]">
              {t("settings.availableModels")}{" "}
              <span>{t("common.items", { count: models.length })}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {models
                .filter((model) => model.id.toLowerCase().includes(modelQuery.toLowerCase()))
                .map((model) => (
                  <div
                    data-ui="available-model"
                    data-model-id={model.id}
                    className="flex items-center gap-[9px] border-b border-[#edf1f5] px-[3px] py-3 [&_small]:mt-1 [&_small]:block [&_small]:truncate [&_small]:text-[9px] [&_small]:text-[#9cacbd] [&_strong]:block [&_strong]:truncate [&_strong]:text-[11px] [&>div]:min-w-0 [&>div]:flex-1"
                    key={model.id}
                  >
                    <span className="grid size-[30px] place-items-center rounded-[7px] bg-[#eef2fa] text-[11px] font-bold text-[#597ba8]">
                      {model.id.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong>{model.id}</strong>
                      <small>{model.ownedBy || t("settings.compatibleModel")}</small>
                    </div>
                    <button
                      aria-pressed={draftModels.some((item) => item.id === model.id)}
                      className="flex items-center gap-1 rounded-[6px] border border-[#d7e3f1] bg-white px-2 py-[6px] text-[10px] text-[#4d79b2] aria-pressed:border-[#caddf7] aria-pressed:bg-[#e9f3ff] aria-pressed:text-[#3175c8]"
                      onClick={() => toggleAddedModel(model)}
                    >
                      {draftModels.some((item) => item.id === model.id) ? (
                        <>
                          <Check size={16} />
                          {t("settings.modelAdded")}
                        </>
                      ) : (
                        <>
                          <Plus size={16} />
                          {t("settings.addModel")}
                        </>
                      )}
                    </button>
                  </div>
                ))}
              {models.length === 0 && (
                <p className="text-[11px] leading-[1.6] text-[#9aabba]">
                  {modelsError && (
                    <>
                      {localizeMessage(modelsError)} {t("settings.manualModelHint")}
                      <br />
                    </>
                  )}
                  {t("settings.noModels")}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-[#e8edf4] pt-[15px] text-[10px] text-[#8b9db1]">
              <span>{t("settings.selectedModels", { count: shownModels.length })}</span>
              <button
                className={ui.primaryButton}
                disabled={busy}
                onClick={async () => {
                  if (await save()) setModels(null);
                }}
              >
                <Check size={17} />
                {t("common.done")}
              </button>
            </div>
          </aside>
        </dialog>
      )}
    </>
  );
}

/** Capability edits belong to individual models and are saved with the provider draft. */
function ModelImageCapability({
  provider,
  model,
  value,
  onChange,
  onError,
}: {
  provider: Provider;
  model: ModelInfo;
  value: boolean | undefined;
  onChange: (value: boolean) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [stored, setStored] = useState<boolean>();
  const required =
    !!model.formulaOcr &&
    !!services.ocr.adapters().find((adapter) => adapter.id === model.formulaOcr)?.requiresVision;
  useEffect(() => {
    let cancelled = false;
    setStored(undefined);
    void services.providers
      .supportsImages(provider, model.id)
      .then((capability) => {
        if (!cancelled) setStored(capability);
      })
      .catch((cause) => {
        if (!cancelled) onError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [provider.id, model.id, model.formulaOcr]);
  return (
    <label className="flex flex-none items-center gap-1.5 text-[10px] text-[#607590]">
      <input
        type="checkbox"
        className="accent-brand"
        aria-label={t("settings.modelVision", { model: model.id })}
        checked={required || (value ?? stored ?? false)}
        disabled={required || !!model.formulaOcr || stored === undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      {t("settings.vision")}
    </label>
  );
}
