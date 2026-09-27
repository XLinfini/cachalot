import i18n from "i18next";
import { parseMessage, type MessageCode, type MessageValues } from "../domain/messages";
import { zh } from "./locales/zh";
type NoticeKey = `messages.${MessageCode}` | `nativeErrors.${keyof typeof zh.nativeErrors}`;

// Older cached warnings and Tauri's existing string errors are recognized at
// the presentation boundary. New TS services send language-neutral codes.
// No cached PDF data needs to be rewritten or analyzed again for a UI switch.
const legacyTemplates = (["messages", "nativeErrors"] as const).flatMap((namespace) =>
  Object.entries(zh[namespace]).map(([key, template]) => {
    const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = escaped.replace(/\\\{\\\{(\w+)\\\}\\\}/g, "(?<$1>.*?)");
    return { key: `${namespace}.${key}` as NoticeKey, pattern: new RegExp(`^${pattern}$`, "su") };
  }),
);

export function localizeMessage(value: string): string {
  const parsed = parseMessage(value);
  if (parsed) return i18n.t(`messages.${parsed.code}`, parsed.values);
  const plain = value.replace(/^Error:\s*/, "");
  if (plain === "找不到该模型服务商") return i18n.t("messages.providerNotFound");
  for (const { key, pattern } of legacyTemplates) {
    const match = plain.match(pattern);
    if (match) return i18n.t(key, (match.groups || {}) as MessageValues);
  }
  // External errors are diagnostic text, not translation keys or HTML.
  return plain;
}
