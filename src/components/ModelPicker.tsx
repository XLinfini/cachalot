import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronRight, ChevronUp, Eye, Search, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Provider } from "../domain/records";
import { chatModels, ocrModels } from "../domain/provider-models";
import { cx, ui } from "../sdk/ui/styles";

interface Props {
  providers: Provider[];
  selected: Provider | null;
  vision: boolean;
  disabled?: boolean;
  purpose?: "chat" | "ocr";
  onSelect: (providerId: string, modelId: string) => void;
  onOpenSettings: () => void;
}

/** A single model choice, grouped by provider. The popup grows upward inside
 * the composer. Its only source is the user's added models, never the provider
 * catalogue. Opening or expanding this menu cannot make provider requests. */
export default function ModelPicker({
  providers,
  selected,
  vision,
  disabled,
  purpose = "chat",
  onSelect,
  onOpenSettings,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const host = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const modelsFor = purpose === "ocr" ? ocrModels : chatModels;
  const chooseLabel = t(purpose === "ocr" ? "ocr.chooseModel" : "chat.chooseModel");
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  const expand = (provider: Provider) => {
    const next = expanded === provider.id ? null : provider.id;
    setExpanded(next);
  };
  return (
    <div
      ref={host}
      data-ui="model-picker"
      className="relative ml-auto w-fit max-w-[210px] min-w-0 flex-initial"
    >
      <button
        ref={trigger}
        type="button"
        data-ui="model-picker-trigger"
        aria-label={chooseLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        disabled={disabled}
        title={selected ? `${selected.name} · ${selected.modelId}` : chooseLabel}
        className="flex w-full min-w-0 items-center gap-1 rounded-[6px] border-0 bg-[#f3f7fc] px-2 py-[6px] text-[10px] text-[#52749c] hover:bg-brand-soft disabled:opacity-50"
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
      >
        {vision && <Eye size={13} className="flex-none" aria-label={t("chat.visionModel")} />}
        <span className="min-w-0 flex-1 truncate text-right">
          {selected?.modelId || chooseLabel}
        </span>
        <ChevronUp size={13} className="flex-none" />
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={t("chat.modelMenu")}
          data-ui="model-menu"
          className="absolute right-0 bottom-full z-40 mb-2 flex max-h-[min(420px,55vh)] w-[min(330px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl border border-[#d8e3f0] bg-white text-[#344d68] shadow-[0_12px_40px_#193d6930]"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {providers
              .filter(
                (provider) =>
                  (purpose !== "chat" || provider.purpose !== "ocr") &&
                  (modelsFor(provider).length > 0 ||
                    (purpose === "chat" && !ocrModels(provider).length)),
              )
              .map((provider) => (
                <div key={provider.id}>
                  <button
                    type="button"
                    aria-expanded={expanded === provider.id}
                    className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent p-2 text-left text-[11px] font-semibold hover:bg-[#f3f7fc]"
                    onClick={() => expand(provider)}
                  >
                    <ChevronRight
                      size={14}
                      className={cx(
                        "flex-none transition-transform",
                        expanded === provider.id && "rotate-90",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{provider.name}</span>
                  </button>
                  {expanded === provider.id && (
                    <div className="mb-1 ml-4 border-l border-[#e6edf5] pl-1">
                      {modelsFor(provider)
                        .filter(
                          (model) =>
                            model.id && model.id.toLowerCase().includes(query.toLowerCase()),
                        )
                        .map((model) => (
                          <button
                            key={model.id}
                            type="button"
                            aria-pressed={
                              selected?.id === provider.id && selected.modelId === model.id
                            }
                            className="flex w-full items-center gap-2 rounded-[6px] border-0 bg-transparent px-2 py-2 text-left text-[11px] hover:bg-[#f3f7fc] aria-pressed:bg-brand-soft aria-pressed:text-brand"
                            onClick={() => {
                              onSelect(provider.id, model.id);
                              setOpen(false);
                              trigger.current?.focus();
                            }}
                          >
                            <span className="min-w-0 flex-1 break-all">{model.id}</span>
                            {selected?.id === provider.id && selected.modelId === model.id && (
                              <Check size={14} className="flex-none" />
                            )}
                          </button>
                        ))}
                      {!modelsFor(provider).length && (
                        <p className="px-2 py-1 text-[10px] text-subtle">{t("chat.noModels")}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
          </div>
          <div className="flex items-center gap-2 border-t border-[#e6edf5] p-2">
            <label className={cx(ui.searchBox, "min-w-0 flex-1")}>
              <Search size={14} />
              <input
                ref={search}
                className={ui.searchInput}
                aria-label={t("settings.searchModels")}
                placeholder={t("settings.searchModels")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={ui.iconButton}
              title={t("chat.modelSettings")}
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <Settings2 size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
