import type { Label, ReaderDecoration, ReaderSelection, TreeItem } from "../../sdk";
/** Validate worker-supplied presentation data before it reaches React or page geometry. */
export function extensionLabel(value: unknown): asserts value is Label {
  if (typeof value === "string" && value.length <= 10000) return;
  if (
    value &&
    typeof value === "object" &&
    "zh" in value &&
    "en" in value &&
    typeof value.zh === "string" &&
    typeof value.en === "string" &&
    value.zh.length <= 10000 &&
    value.en.length <= 10000
  )
    return;
  throw new Error("Invalid extension label");
}
function text(value: unknown, max = 10000): asserts value is string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid extension text");
}
function finite(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Invalid extension coordinate");
}
export function treeItems(value: unknown): TreeItem[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new Error("Invalid or excessive tree items");
  for (const item of value) {
    if (!item || typeof item !== "object") throw new Error("Invalid tree item");
    text(item.id, 256);
    extensionLabel(item.label);
    if (item.description !== undefined) extensionLabel(item.description);
    if (item.command !== undefined) {
      text(item.command?.command, 256);
      if (
        item.command.arguments !== undefined &&
        (!Array.isArray(item.command.arguments) || item.command.arguments.length > 64)
      )
        throw new Error("Invalid tree command");
    }
  }
  return value;
}
export function decorations(value: unknown): ReaderDecoration[] {
  if (!Array.isArray(value) || value.length > 4096)
    throw new Error("Invalid or excessive reader decorations");
  for (const item of value) {
    text(item?.id, 256);
    if (!Array.isArray(item.box) || item.box.length !== 4)
      throw new Error("Invalid decoration box");
    item.box.forEach(finite);
    text(item.borderColor, 100);
    text(item.backgroundColor ?? "", 100);
    if (item.label !== undefined) text(item.label);
  }
  return value;
}
export function selection(value: unknown): ReaderSelection | null {
  if (value === null || value === undefined) return null;
  const item = value as ReaderSelection;
  text(item.documentId, 256);
  finite(item.page);
  if (!Number.isInteger(item.page) || item.page < 1) throw new Error("Invalid selection page");
  [item.x, item.y, item.width, item.height].forEach(finite);
  if (
    item.x < 0 ||
    item.y < 0 ||
    item.width <= 0 ||
    item.height <= 0 ||
    item.x + item.width > 1.001 ||
    item.y + item.height > 1.001
  )
    throw new Error("Invalid selection box");
  text(item.text, 8 * 1024 * 1024);
  text(item.imageDataUrl, 16 * 1024 * 1024);
  if (!item.imageDataUrl.startsWith("data:image/")) throw new Error("Invalid selection image");
  if (
    item.characterIndices !== undefined &&
    (!Array.isArray(item.characterIndices) ||
      item.characterIndices.length > 1000000 ||
      item.characterIndices.some((index) => !Number.isSafeInteger(index) || index < 0))
  )
    throw new Error("Invalid selection characters");
  return item;
}
export function contribution(value: any, methods: string[]): void {
  text(value?.id, 256);
  extensionLabel(value.title);
  if (value.tooltip !== undefined) extensionLabel(value.tooltip);
  if (value.icon !== undefined) extensionLabel(value.icon);
  if (methods.some((name) => typeof value[name] !== "function"))
    throw new Error("Invalid extension contribution methods");
}
export function statusProperty(name: string, value: unknown): void {
  if (name === "text" || (name === "tooltip" && value !== undefined)) extensionLabel(value);
  if (name === "command" && value !== undefined) text(value, 256);
}
