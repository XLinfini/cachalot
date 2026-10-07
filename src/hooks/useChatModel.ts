import { useEffect, useMemo, useState } from "react";
import { services } from "../application/services";
import type { ModelSelection, Provider } from "../domain/records";
import {
  isChatSelection,
  parseModelSelection,
  resolveDefaultModel,
} from "../domain/provider-models";

/** A global default and an optional current choice shared by chat and extensions.
 * Both reference configured chat models by provider/model pair. */
export function useChatModel(onError: (error: string) => void) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaultModel, setDefaultModel] = useState<ModelSelection | null>(null);
  const [activeModel, setActiveModel] = useState<ModelSelection | null>(null);
  const [ready, setReady] = useState(false);
  const [vision, setVision] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      services.providers.list(),
      services.settings.get("defaultModel"),
      services.settings.get("activeProviderId"),
      services.settings.get("activeModel"),
    ])
      .then(([modelProviders, storedDefault, legacyProviderId, storedActive]) => {
        if (cancelled) return;
        const restoredDefault = resolveDefaultModel(
          modelProviders,
          parseModelSelection(storedDefault),
          storedDefault === null ? legacyProviderId : undefined,
        );
        const restoredActive = parseModelSelection(storedActive);
        setProviders(modelProviders);
        setDefaultModel(restoredDefault);
        setActiveModel(isChatSelection(modelProviders, restoredActive) ? restoredActive : null);
        setReady(true);
        // Migrate once, without promoting catalogues or stale current choices to configured models.
        if (storedDefault !== JSON.stringify(restoredDefault))
          void services.settings
            .set("defaultModel", JSON.stringify(restoredDefault))
            .catch((cause) => onError(String(cause)));
        if (storedActive && !isChatSelection(modelProviders, restoredActive))
          void services.settings.set("activeModel", "").catch((cause) => onError(String(cause)));
      })
      .catch((cause) => {
        if (!cancelled) onError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const resolvedDefault = useMemo(
    () => resolveDefaultModel(providers, defaultModel),
    [providers, defaultModel],
  );
  const activeProvider = useMemo(() => {
    const choice = isChatSelection(providers, activeModel) ? activeModel : resolvedDefault;
    if (!choice) return null;
    const provider = providers.find((item) => item.id === choice.providerId)!;
    return { ...provider, modelId: choice.modelId };
  }, [providers, activeModel, resolvedDefault]);

  useEffect(() => {
    if (!ready) return;
    if (JSON.stringify(defaultModel) !== JSON.stringify(resolvedDefault)) {
      setDefaultModel(resolvedDefault);
      void services.settings
        .set("defaultModel", JSON.stringify(resolvedDefault))
        .catch((cause) => onError(String(cause)));
    }
    if (activeModel && !isChatSelection(providers, activeModel)) {
      // Historical messages retain their images; new requests fall back to the global default.
      setActiveModel(null);
      void services.settings.set("activeModel", "").catch((cause) => onError(String(cause)));
    }
  }, [ready, providers, activeModel, defaultModel, resolvedDefault, onError]);

  useEffect(() => {
    let cancelled = false;
    setVision(false);
    if (activeProvider)
      void services.providers
        .supportsImages(activeProvider, activeProvider.modelId)
        .then((value) => {
          if (!cancelled) setVision(value);
        })
        .catch((cause) => {
          if (!cancelled) onError(String(cause));
        });
    return () => {
      cancelled = true;
    };
  }, [activeProvider, onError]);

  const chooseModel = (providerId: string, modelId: string) => {
    const selected = { providerId, modelId };
    if (!isChatSelection(providers, selected)) return;
    setActiveModel(selected);
    void services.settings
      .set("activeModel", JSON.stringify(selected))
      .catch((cause) => onError(String(cause)));
  };

  const chooseDefaultModel = async (selected: ModelSelection) => {
    if (!isChatSelection(providers, selected)) return;
    await services.settings.set("defaultModel", JSON.stringify(selected));
    await services.settings.set("activeModel", "");
    setDefaultModel(selected);
    setActiveModel(null);
  };

  return {
    providers,
    setProviders,
    activeProviderId: activeProvider?.id || null,
    activeProvider,
    defaultModel: resolvedDefault,
    chooseDefaultModel,
    vision,
    chooseModel,
  };
}
