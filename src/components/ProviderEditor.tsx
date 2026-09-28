import { useEffect, useState } from "react";
import { Check, CircleHelp, Database, Layers3, Plus, Search, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import type { FormulaOcrProtocol, ModelInfo, Provider, ProviderInput } from "../domain/records";
import { addedModels, chatModels, ocrModels } from "../domain/provider-models";
import { GLM_OCR_BASE_URL, GLM_OCR_MODEL, glmOcrEndpoint } from "../domain/ocr";
import { apiEndpoint } from "../domain/api-endpoint";
import { message } from "../domain/messages";
import { visionKey } from "../application/model-catalog";
import { localizeMessage } from "../i18n/messages";
import { cx, ui } from "./ui/styles";
import ApiKeyField from "./ApiKeyField";

interface Props {
  purpose: "llm" | "ocr";
  providers: Provider[];
  activeProviderId: string | null;
  onProvidersChange: (providers: Provider[]) => void;
  onActiveProviderChange: (id: string | null) => void;
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
  onActiveProviderChange,
  onError,
  embedded = false,
}: Props) {
  const { t } = useTranslation();
  const visibleProviders = providers.filter((provider) =>
    purpose === "llm"
      ? provider.purpose !== "ocr"
      : provider.purpose === "ocr" || ocrModels(provider).length > 0,
  );
  const Element = embedded ? "section" : "main";
  const [modelsError, setModelsError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderInput | null>(null);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [vision, setVision] = useState(false);
  const [visionModel, setVisionModel] = useState("");
  const draftModels = draft ? addedModels(draft) : [];
  const shownModels =
    purpose === "ocr"
      ? draftModels.filter((model) => draft?.purpose === "ocr" || !!model.formulaOcr)
      : draftModels.filter((model) => !model.formulaOcr || model.formulaOcr === "vision-llm");
  const draftProtocol = draftModels.find((m) => m.id === draft?.modelId)?.formulaOcr;
  const requestUrls = (() => {
    if (!draft) return null;
    try {
      return {
        models: apiEndpoint(draft.baseUrl, "models"),
        chat: apiEndpoint(draft.baseUrl, "chat/completions"),
        ocr: glmOcrEndpoint(draft.baseUrl),
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
    if (!draft) return;
    let cancelled = false;
    setVision(false);
    setVisionModel("");
    const provider = providers.find((item) => item.id === draft.id) || { ...draft, hasKey: false };
    void services.providers
      .supportsImages(provider, draft.modelId)
      .then((value) => {
        if (!cancelled) {
          setVision(value);
          setVisionModel(visionKey(draft.id, draft.modelId));
        }
      })
      .catch((cause) => onError(String(cause)));
    return () => {
      cancelled = true;
    };
  }, [draft?.id, draft?.modelId]);

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

  const createGlmProvider = () => {
    const id = crypto.randomUUID();
    setSelectedId(id);
    setDraft({
      id,
      purpose: "ocr",
      name: "GLM-OCR",
      baseUrl: GLM_OCR_BASE_URL,
      modelId: GLM_OCR_MODEL.id,
      enabled: true,
      apiKey: "",
      addedModels: [{ ...GLM_OCR_MODEL }],
    });
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
    if (model.id === draft.modelId && protocol === "vision-llm") setVision(true);
  };
  const profileOptions = (
    <>
      <option value="">{t("ocr.profileNone")}</option>
      <option value="glm-layout">{t("ocr.profileGlm")}</option>
      <option value="formula-chat">{t("ocr.profileChat")}</option>
      <option value="vision-llm">{t("ocr.profileVision")}</option>
    </>
  );

  const toggleAddedModel = (model: ModelInfo) => {
    setDraft((current) => {
      if (!current) return current;
      const models = addedModels(current);
      const next = models.some((item) => item.id === model.id)
        ? models.filter((item) => item.id !== model.id)
        : [
            ...models,
            purpose === "ocr" && !model.formulaOcr
              ? { ...model, formulaOcr: "formula-chat" as const }
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
      if (visionModel === visionKey(saved.id, saved.modelId))
        await services.settings.set(visionModel, String(vision));
      onProvidersChange([saved, ...providers.filter((item) => item.id !== saved.id)]);
      if (purpose === "llm" && !activeProviderId && chatModels(saved).length)
        onActiveProviderChange(saved.id);
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
      if (activeProviderId === draft.id) onActiveProviderChange(null);
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
        className={
          embedded
            ? "mt-10"
            : "min-w-0 flex-1 overflow-y-auto px-[max(30px,calc((100vw_-_1160px)/2))] pt-[52px] pb-[50px] max-desktop:px-[28px] max-desktop:py-[44px]"
        }
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
        <div className="grid grid-cols-[270px_minmax(440px,1fr)] gap-5 max-desktop:grid-cols-[220px_minmax(360px,1fr)] max-compact:grid-cols-1">
          <section className={cx(ui.surface, "min-h-[380px] self-start px-[13px] py-[18px]")}>
            <div className="flex items-center justify-between px-[5px] pb-4 [&>span]:text-[10px] [&>span]:text-[#9cabbc] [&>strong]:text-[12px]">
              <strong>{t("settings.provider")}</strong>
              <span>{t("common.items", { count: visibleProviders.length })}</span>
            </div>
            <label className={cx(ui.searchBox, "h-[34px]")}>
              <Search size={16} />
              <input className={ui.searchInput} placeholder={t("settings.searchProviders")} />
            </label>
            <div className={cx(ui.eyebrow, "px-[7px] pt-5 pb-[10px]")}>{t("settings.custom")}</div>
            {visibleProviders.map((item) => (
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
            <button
              className="mt-[11px] flex w-full items-center gap-[7px] rounded-lg border border-dashed border-[#c9d9ec] bg-[#f9fbfe] p-[9px] text-[11px] text-[#3b78c4]"
              onClick={createProvider}
            >
              <Plus size={17} />
              {t("settings.addProvider")}
            </button>
            {purpose === "ocr" && (
              <button
                data-ui="add-glm-ocr"
                className="mt-2 w-full rounded-lg border border-[#c9d9ec] bg-white p-[9px] text-[11px] text-brand"
                onClick={createGlmProvider}
              >
                {t("ocr.addGlm")}
              </button>
            )}
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
                      {t(
                        purpose === "ocr" && draftProtocol === "glm-layout"
                          ? "ocr.profileGlm"
                          : "settings.compatibleApi",
                      )}
                    </p>
                  </div>
                  <label className="relative inline-flex cursor-pointer">
                    <input
                      className="peer sr-only"
                      aria-label={t("settings.enableProvider")}
                      type="checkbox"
                      checked={draft.enabled}
                      onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                    />
                    <span className="relative block h-5 w-[35px] rounded-[14px] bg-[#c8d4e1] peer-checked:bg-[#3679d2] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus peer-checked:[&>span]:translate-x-[15px]">
                      <span className="absolute top-[3px] left-[3px] size-[14px] rounded-full bg-white transition-transform duration-150" />
                    </span>
                  </label>
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
                    {purpose === "ocr" && requestUrls && draftProtocol === "glm-layout" ? (
                      <>
                        <p data-ui="ocr-endpoint" className="font-mono break-all">
                          {requestUrls.ocr}
                        </p>
                        <p>{t("ocr.glmHint")}</p>
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
                  <div className="grid grid-cols-2 gap-3">
                    <label className={ui.fieldLabel}>
                      {t("settings.modelId")}
                      <input
                        className={cx(ui.fieldInput, "block")}
                        value={draft.modelId}
                        onChange={(event) => setDraft({ ...draft, modelId: event.target.value })}
                        placeholder={t("settings.modelPlaceholder")}
                      />
                    </label>
                    {purpose === "llm" && (
                      <label className="my-[21px] flex items-center gap-2 text-[10px] font-semibold text-[#607590]">
                        <input
                          className="accent-brand"
                          type="checkbox"
                          checked={draftProtocol === "vision-llm" || (!draftProtocol && vision)}
                          disabled={
                            !!draftProtocol || visionModel !== visionKey(draft.id, draft.modelId)
                          }
                          onChange={(event) => setVision(event.target.checked)}
                        />
                        {t("settings.vision")}
                      </label>
                    )}
                  </div>
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
                        {profileOptions}
                      </select>
                      {draftProtocol && draftProtocol !== "vision-llm" && (
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
                    <p>
                      {t("settings.currentModel", {
                        model: draft.modelId || t("settings.noModel"),
                      })}
                    </p>
                  </div>
                  <button
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
                      <Database size={17} className="flex-none" />
                      <span className="min-w-0 flex-1 break-all">{model.id}</span>
                      {purpose === "ocr" && (
                        <select
                          data-ui="model-ocr-profile"
                          aria-label={t("ocr.modelProfile", { model: model.id })}
                          className="max-w-[170px] rounded border border-border bg-white p-1 text-[10px]"
                          value={model.formulaOcr || ""}
                          onChange={(e) => setOcrProfile(model.id, e.target.value)}
                        >
                          {profileOptions}
                        </select>
                      )}
                      {draft.modelId === model.id ? (
                        <span className="flex-none rounded-[4px] bg-[#e5f0ff] px-[5px] py-[3px] text-[10px] text-[#3d7ac8]">
                          {t("settings.default")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="flex-none border-0 bg-transparent text-[10px] text-[#3477c8]"
                          aria-label={t("settings.useModel", { model: model.id })}
                          onClick={() => setDraft({ ...draft, modelId: model.id })}
                        >
                          {t("settings.makeDefault")}
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
                  {purpose === "llm" &&
                    activeProviderId !== draft.id &&
                    chatModels(draft).length > 0 && (
                      <button
                        className="border-0 bg-transparent text-[10px] text-[#3477c8]"
                        onClick={() => onActiveProviderChange(draft.id)}
                      >
                        {t("settings.makeDefault")}
                      </button>
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
        <div
          className="fixed inset-0 z-20 flex items-center justify-end bg-[#1c2b42]/45"
          onMouseDown={() => setModels(null)}
        >
          <aside
            data-ui="model-drawer"
            className="flex h-full w-[420px] flex-col bg-white px-[22px] py-[26px] shadow-[-15px_0_45px_#10254433]"
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
        </div>
      )}
    </>
  );
}
