import { satisfies, valid, validRange } from "semver";
import type { ExtensionManifest } from "../../sdk";
export const HOST_API_VERSION = "0.1.0";
export const extensionId = (manifest: ExtensionManifest) =>
  `${manifest.publisher}.${manifest.name}`;
export const ID_PATTERN = /^[a-z0-9-]+\.[a-z0-9-]+$/;
export function packagePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !/[\\\x00-\x1f:]/.test(path) &&
    !path.startsWith("/") &&
    path.split("/").every((part) => part !== ".." && part !== "." && part !== "")
  );
}
/** Only validated JSON crosses from an installation package into the host. */
export function validateManifest(value: unknown): ExtensionManifest {
  const fail = (field: string): never => {
    throw new Error(`Invalid extension manifest: ${field}`);
  };
  const object = (item: unknown): Record<string, unknown> => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("object");
    return item as Record<string, unknown>;
  };
  const text = (item: unknown, field: string): string => {
    if (typeof item !== "string" || !item || item.length > 10000) return fail(field);
    return item;
  };
  const label = (item: unknown, field: string) => {
    if (typeof item === "string") text(item, field);
    else {
      const entry = object(item);
      text(entry.zh, field);
      text(entry.en, field);
    }
  };
  const list = (item: unknown, field: string): unknown[] => {
    if (!Array.isArray(item) || item.length > 256) return fail(field);
    return item;
  };
  const m = object(value),
    id = `${text(m.publisher, "publisher")}.${text(m.name, "name")}`;
  if (id.length > 128 || !ID_PATTERN.test(id)) fail("publisher.name");
  if (!valid(text(m.version, "version"))) fail("version (SemVer)");
  label(m.displayName, "displayName");
  label(m.description, "description");
  const range = text(object(m.engines).cachalot, "engines.cachalot");
  if (!validRange(range) || validRange(range) === "*" || !satisfies(HOST_API_VERSION, range))
    fail(`engines.cachalot (${range}; host ${HOST_API_VERSION})`);
  for (const key of ["extensionDependencies", "extensionPack"] as const) {
    if (m[key] === undefined) continue;
    const ids = list(m[key], key);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((item) => typeof item !== "string" || !ID_PATTERN.test(item) || item === id)
    )
      fail(key);
  }
  if (
    m.main !== undefined &&
    (!packagePath(text(m.main, "main")) || !String(m.main).endsWith(".js"))
  )
    fail("main");
  const capabilities = list(m.capabilities, "capabilities");
  if (
    new Set(capabilities).size !== capabilities.length ||
    capabilities.some(
      (item) =>
        !["documents.read", "reader.interact", "reader.decorate", "ocr", "lm"].includes(
          String(item),
        ),
    )
  )
    fail("capabilities");
  for (const event of list(m.activationEvents, "activationEvents"))
    if (
      event !== "onStartupFinished" &&
      event !== "onDocumentOpen" &&
      !(typeof event === "string" && event.startsWith(`onCommand:${id}.`))
    )
      fail("activationEvents");
  const c = m.contributes === undefined ? {} : object(m.contributes),
    ids: string[] = [];
  for (const [key, idField] of [
    ["commands", "command"],
    ["views", "id"],
    ["viewsContainers", "id"],
    ["configuration", "key"],
  ]) {
    if (c[key] === undefined) continue;
    const keys = new Set<string>();
    for (const item of list(c[key], key)) {
      const entry = object(item),
        entryId = text(entry[idField], key);
      if (keys.has(entryId)) fail(`${key}.duplicate`);
      keys.add(entryId);
      label(entry.title, `${key}.title`);
      if (key === "configuration") {
        if (typeof entry.default !== "string") fail("configuration.default");
        if (entry.description !== undefined) label(entry.description, "configuration.description");
      } else {
        if (!entryId.startsWith(`${id}.`)) fail(`${key}.namespace`);
        ids.push(entryId);
      }
      if (key === "views" || key === "viewsContainers") {
        const locations =
          key === "views"
            ? ["sidebar.left", "sidebar.right", "panel", "settings", "modal"]
            : ["sidebar.left", "sidebar.right", "panel"];
        if (!locations.includes(String(entry.location))) fail(`${key}.location`);
      }
    }
  }
  if (new Set(ids).size !== ids.length) fail("duplicate contribution ID");
  const manifest = structuredClone(m) as unknown as ExtensionManifest;
  for (const view of manifest.contributes?.views || [])
    if (
      view.container &&
      !manifest.contributes?.viewsContainers?.some(
        (container) => container.id === view.container && container.location === view.location,
      )
    )
      fail("views.container");
  if (c.menus !== undefined)
    for (const item of list(c.menus, "menus")) {
      const entry = object(item);
      if (
        entry.location !== "reader.toolbar" ||
        !manifest.contributes?.commands?.some((command) => command.command === entry.command)
      )
        fail("menus.command");
    }
  for (const event of manifest.activationEvents)
    if (
      event.startsWith("onCommand:") &&
      !manifest.contributes?.commands?.some((command) => event === `onCommand:${command.command}`)
    )
      fail("activationEvents.command");
  return manifest;
}
