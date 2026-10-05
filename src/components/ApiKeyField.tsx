import { useEffect, useId, useRef, useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { services } from "../application/services";
import type { Provider } from "../domain/records";
import { ui } from "../sdk/ui/styles";

interface Props {
  provider?: Provider;
  value: string;
  onChange: (value: string) => void;
  onError: (message: string) => void;
}

/** Stored previews and revealed credentials never become a replacement draft.
 * Only typing calls onChange; saving an untouched field preserves the key.
 */
export default function ApiKeyField({ provider, value, onChange, onError }: Props) {
  const { t } = useTranslation();
  const inputId = useId();
  const [preview, setPreview] = useState("");
  const [revealedKey, setRevealedKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    setPreview("");
    setRevealedKey("");
    setVisible(false);
    setEditing(false);
    setLoading(false);
    if (provider?.hasKey) {
      void services.providers.keyPreview(provider.id).then(
        (mask) => {
          if (version === requestVersion.current) setPreview(mask || "");
        },
        (cause) => {
          if (version === requestVersion.current) onError(String(cause));
        },
      );
    }
    // Ignore a delayed response after switching providers, saving or closing.
    return () => {
      requestVersion.current++;
    };
  }, [provider, onError]);

  const toggleVisibility = async () => {
    if (visible) {
      setVisible(false);
      setRevealedKey("");
      return;
    }
    if (value) {
      setVisible(true);
      return;
    }
    if (!provider?.hasKey) {
      setVisible(true);
      return;
    }
    const version = requestVersion.current;
    setLoading(true);
    try {
      const key = await services.providers.revealKey(provider.id);
      if (version !== requestVersion.current) return;
      setRevealedKey(key || "");
      setEditing(false);
      setVisible(true);
    } catch (cause) {
      if (version === requestVersion.current) onError(String(cause));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  };

  const showingPreview = Boolean(preview) && !visible && !editing && !value;
  return (
    <div className={ui.fieldLabel}>
      <label htmlFor={inputId}>
        {t("settings.apiKey")}{" "}
        <span className="font-normal text-[#a7b5c4]">
          {value
            ? t("settings.keyPending")
            : provider?.hasKey
              ? t("settings.keySaved")
              : t("settings.keyMissing")}
        </span>
      </label>
      <div className="mt-2 flex w-full items-center gap-[7px] rounded-[7px] border border-[#dce5ef] bg-white py-[7px] pr-[7px] pl-[10px] text-[11px] text-[#9dabbb] focus-within:border-brand">
        <KeyRound size={16} aria-hidden="true" />
        <input
          id={inputId}
          data-ui="api-key-input"
          aria-label={t("settings.apiKey")}
          className="min-w-0 flex-1 border-0 bg-transparent text-[11px] font-normal text-[#2e4866] outline-none placeholder:text-[#b1bdcb]"
          type={visible || showingPreview ? "text" : "password"}
          value={value || (visible ? revealedKey : showingPreview ? preview : "")}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          onFocus={() => {
            // Start a replacement without copying the display mask into the draft.
            if (!visible && !value) setEditing(true);
          }}
          onBlur={() => {
            if (!value) setEditing(false);
          }}
          onChange={(event) => onChange(event.target.value)}
          placeholder={preview || t("settings.keyPlaceholder")}
        />
        <button
          type="button"
          data-ui="api-key-toggle"
          className="flex size-6 flex-none items-center justify-center rounded border-0 bg-transparent text-[#8398b1] hover:bg-[#eef4fc] hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
          aria-label={t(visible ? "settings.hideKey" : "settings.showKey")}
          title={t(visible ? "settings.hideKey" : "settings.showKey")}
          aria-pressed={visible}
          disabled={loading}
          onClick={() => void toggleVisibility()}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}
