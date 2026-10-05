import { useEffect, useRef, useState } from "react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  useAuiState,
  type AssistantRuntime,
} from "@assistant-ui/react";
import { Plus, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { message } from "../domain/messages";
import type { Provider } from "../domain/records";
import ModelPicker from "./ModelPicker";
import { ui } from "../sdk/ui/styles";

interface Props {
  runtime: AssistantRuntime;
  provider: Provider | null;
  providers: Provider[];
  vision: boolean;
  running: boolean;
  onSelectModel: (providerId: string, modelId: string) => void;
  onOpenSettings: () => void;
  onError: (error: string) => void;
}

function ImageAttachment() {
  const { t } = useTranslation();
  const attachment = useAuiState((state) => state.attachment);
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!attachment.file) return;
    const next = URL.createObjectURL(attachment.file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [attachment.file]);
  return (
    <AttachmentPrimitive.Root data-ui="draft-image" className="relative flex-none">
      <img
        src={url || undefined}
        alt={t("chat.imageAlt", { name: attachment.name })}
        className="size-14 rounded-md border border-[#d8e3f0] object-cover"
      />
      <AttachmentPrimitive.Remove
        className="absolute -top-1 -right-1 grid size-5 place-items-center rounded-full border border-[#d8e3f0] bg-white text-[12px] text-[#52749c]"
        aria-label={t("chat.removeImage", { name: attachment.name })}
      >
        ×
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}

function ComposerContent({
  runtime,
  provider,
  providers,
  vision,
  running,
  onSelectModel,
  onOpenSettings,
  onError,
}: Props) {
  const { t } = useTranslation();
  const images = useAuiState((state) => state.composer.attachments);
  const input = useRef<HTMLInputElement>(null);
  const blockedDraft = images.length > 0 && !vision;
  return (
    <>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        data-ui="chat-image-input"
        onChange={(event) => {
          const files = Array.from(event.target.files || []);
          event.target.value = "";
          if (!vision || running) return;
          void (async () => {
            for (const file of files) {
              if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
                throw new Error(message("imageFileInvalid"));
              if (file.size > 10 * 1024 * 1024) throw new Error(message("imageFileTooLarge"));
              await runtime.thread.composer.addAttachment(file);
            }
          })().catch((cause) => onError(String(cause)));
        }}
      />
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-3 pt-3 pb-1">
          <ComposerPrimitive.Attachments components={{ Attachment: ImageAttachment }} />
        </div>
      )}
      <ComposerPrimitive.Input
        onKeyDownCapture={(event) => {
          if (blockedDraft && event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onPasteCapture={(event) => {
          if (!vision && event.clipboardData.files.length) {
            event.preventDefault();
            event.stopPropagation();
            onError(message("imageUnsupported"));
          }
        }}
        className="min-h-[70px] w-full resize-none rounded-t-[10px] border-0 px-3 py-[11px] text-[11px] text-[#344d68] outline-none"
        placeholder={t("chat.placeholder")}
        rows={3}
      />
      {blockedDraft && (
        <p role="status" className="px-3 pb-2 text-[10px] text-[#9a6c24]">
          {t("chat.incompatibleDraft")}
        </p>
      )}
      <div className="flex items-center gap-[6px] px-2 pb-2">
        <div
          className="group/upload relative inline-flex flex-none"
          tabIndex={!vision ? 0 : undefined}
          aria-label={!vision ? t("messages.imageUnsupported") : undefined}
        >
          <button
            type="button"
            data-ui="upload-image"
            className={ui.iconButton}
            aria-label={t("chat.uploadImage")}
            disabled={!vision || running}
            onClick={() => input.current?.click()}
          >
            <Plus size={18} />
          </button>
          {!vision && (
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 hidden w-[240px] rounded-lg bg-[#263b56] px-3 py-2 text-[11px] text-white shadow-lg group-focus-within/upload:block group-hover/upload:block"
            >
              {t("messages.imageUnsupported")}
            </span>
          )}
        </div>
        <ModelPicker
          providers={providers}
          selected={provider}
          vision={vision}
          disabled={running}
          onSelect={onSelectModel}
          onOpenSettings={onOpenSettings}
        />
        <ComposerPrimitive.Send
          aria-label={t("chat.send")}
          className="grid size-7 flex-none place-items-center rounded-[7px] border-0 bg-[#2e70cc] text-white disabled:opacity-50"
          disabled={running || !provider?.modelId || blockedDraft}
        >
          <Send size={17} />
        </ComposerPrimitive.Send>
      </div>
    </>
  );
}

export default function ChatComposer(props: Props) {
  return (
    <ComposerPrimitive.Root
      data-ui="chat-composer"
      className="relative mx-[13px] mb-[14px] rounded-[10px] border border-[#d8e3f0] shadow-[0_2px_7px_#193d690e]"
    >
      <ComposerContent {...props} />
    </ComposerPrimitive.Root>
  );
}
