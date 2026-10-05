import { useEffect, useMemo, useState } from "react";
import { services } from "../application/services";
import type { ModelSelection, Provider } from "../domain/records";
import { chatModels, hasChatModel } from "../domain/provider-models";

/** One model choice shared by settings, core chat and the extension host.
 * Only configured chat models are selectable; image capability belongs to the model. */
export function useChatModel(onError: (error: string) => void) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [activeProviderId, setActiveProviderId] = useState<string | null>(null);
  const [activeModel, setActiveModel] = useState<ModelSelection | null>(null);
  const [vision, setVision] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      services.providers.list(),
      services.settings.get("activeProviderId"),
      services.settings.get("activeModel"),
    ])
      .then(([modelProviders, providerId, model]) => {
        if (cancelled) return;
        let restored: ModelSelection | null = null;
        try {
          const value = JSON.parse(model || "null");
          if (
            typeof value?.providerId === "string" &&
            typeof value?.modelId === "string" &&
            modelProviders.some(
              (provider) =>
                provider.enabled &&
                provider.id === value.providerId &&
                hasChatModel(provider, value.modelId),
            )
          )
            restored = value;
        } catch {
          /* Invalid UI selection never changes credentials. */
        }
        setActiveModel(restored);
        setProviders(modelProviders);
        setActiveProviderId(
          restored?.providerId ||
            (modelProviders.some((p) => p.id === providerId && p.enabled && chatModels(p).length)
              ? providerId
              : null) ||
            modelProviders.find((item) => item.enabled && chatModels(item).length)?.id ||
            null,
        );
      })
      .catch((cause) => {
        if (!cancelled) onError(String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const activeProvider = useMemo(() => {
    const configured = providers.find(
      (provider) => provider.id === activeProviderId && provider.enabled,
    );
    if (!configured || !chatModels(configured).length) return null;
    return {
      ...configured,
      modelId:
        activeModel?.providerId === configured.id && hasChatModel(configured, activeModel.modelId)
          ? activeModel.modelId
          : hasChatModel(configured, configured.modelId)
            ? configured.modelId
            : chatModels(configured)[0].id,
    };
  }, [providers, activeProviderId, activeModel]);

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

  useEffect(() => {
    if (
      !activeModel ||
      providers.some(
        (provider) =>
          provider.enabled &&
          provider.id === activeModel.providerId &&
          hasChatModel(provider, activeModel.modelId),
      )
    )
      return;
    // Removing a configured model invalidates the choice; historical messages keep their images.
    setActiveModel(null);
    void services.settings.set("activeModel", "").catch((cause) => onError(String(cause)));
  }, [providers, activeModel, onError]);

  const setProvider = (id: string | null) => {
    setActiveProviderId(id);
    setActiveModel(null);
    void services.settings.set("activeModel", "").catch((cause) => onError(String(cause)));
    void services.settings
      .set("activeProviderId", id || "")
      .catch((cause) => onError(String(cause)));
  };
  const chooseModel = (providerId: string, modelId: string) => {
    if (!providers.some((p) => p.id === providerId && p.enabled && hasChatModel(p, modelId)))
      return;
    const selected = { providerId, modelId };
    setActiveProviderId(providerId);
    setActiveModel(selected);
    void services.settings
      .set("activeModel", JSON.stringify(selected))
      .then(() => services.settings.set("activeProviderId", providerId))
      .catch((cause) => onError(String(cause)));
  };

  return {
    providers,
    setProviders,
    activeProviderId,
    activeProvider,
    vision,
    setProvider,
    chooseModel,
  };
}
