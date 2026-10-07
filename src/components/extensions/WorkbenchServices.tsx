import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { extensionHost } from "../../application/extensions/runtime";
import type { HostInteraction } from "../../application/extensions/interactions";
import type { Label } from "../../sdk";
import { ui } from "../../sdk/ui/styles";
const text = (value: Label | undefined, language?: string) =>
  !value ? "" : typeof value === "string" ? value : language === "en" ? value.en : value.zh;
function moveOption(root: HTMLElement | null, direction: "ArrowDown" | "ArrowUp") {
  if (!root) return;
  const options = [
    ...root.querySelectorAll<HTMLElement>(
      '[role="option"]:not(:disabled),[role="menuitem"]:not(:disabled)',
    ),
  ];
  if (!options.length) return;
  const index = options.indexOf(document.activeElement as HTMLElement);
  options[
    (index + (direction === "ArrowDown" ? 1 : -1) + options.length) % options.length
  ]?.focus();
}
export function openCommandPalette() {
  window.dispatchEvent(new Event("cachalot.commandPalette"));
}

function InteractionDialog({ item }: { item: HostInteraction }) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState(item.value ?? "");
  const [query, setQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const items = (item.items ?? []).filter((option) =>
    (
      text(option.label, i18n.resolvedLanguage) +
      " " +
      text(option.description, i18n.resolvedLanguage)
    )
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) extensionHost.interactions.respond(item.id);
      }}
    >
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label={text(item.title, i18n.resolvedLanguage)}
        className="w-[560px] max-w-[90vw] rounded-xl border border-border bg-white p-5 shadow-xl"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            extensionHost.interactions.respond(item.id);
          }
          if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            (event.target as HTMLElement).getAttribute("role") === "option"
          ) {
            event.preventDefault();
            moveOption(root.current, event.key);
          }
          if (event.key === "Tab") {
            const controls = [
              ...root.current!.querySelectorAll<HTMLElement>("input,button:not(:disabled)"),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 className="mb-3 text-sm font-bold">{text(item.title, i18n.resolvedLanguage)}</h2>
        {item.prompt && (
          <p className="mb-3 text-xs text-muted">{text(item.prompt, i18n.resolvedLanguage)}</p>
        )}
        {item.kind === "input" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              extensionHost.interactions.respond(item.id, value);
            }}
          >
            <input
              aria-label={text(item.title, i18n.resolvedLanguage)}
              className="w-full rounded border border-border p-2"
              type={item.password ? "password" : "text"}
              value={value}
              maxLength={10000}
              onChange={(event) => setValue(event.target.value)}
            />
            <button type="submit" className={ui.primaryButton + " mt-3"}>
              {t("workbench.submit")}
            </button>
          </form>
        ) : (
          <>
            <input
              aria-label={t("workbench.search")}
              className="mb-2 w-full rounded border border-border p-2"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && items[0])
                  extensionHost.interactions.respond(item.id, items[0].id);
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  root.current?.querySelector<HTMLElement>('[role="option"]')?.focus();
                }
              }}
            />
            <div
              role="listbox"
              aria-label={text(item.title, i18n.resolvedLanguage)}
              className="max-h-[45vh] overflow-auto"
            >
              {items.map((option) => (
                <button
                  key={option.id}
                  role="option"
                  aria-selected={false}
                  className="flex w-full flex-col rounded p-2 text-left hover:bg-brand-soft focus:bg-brand-soft"
                  onClick={() => extensionHost.interactions.respond(item.id, option.id)}
                >
                  {text(option.label, i18n.resolvedLanguage)}
                  <span className="text-xs text-muted">
                    {text(option.description, i18n.resolvedLanguage)}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
        <button
          className={ui.secondaryButton + " mt-3"}
          onClick={() => extensionHost.interactions.respond(item.id)}
        >
          {t("workbench.cancel")}
        </button>
      </div>
    </div>
  );
}
export function WorkbenchServices() {
  const snapshot = useSyncExternalStore(extensionHost.subscribe, extensionHost.getSnapshot);
  const { t, i18n } = useTranslation();
  const [palette, setPalette] = useState(false),
    [shortcuts, setShortcuts] = useState(false);
  const [query, setQuery] = useState(""),
    [error, setError] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const paletteRoot = useRef<HTMLDivElement>(null);
  const paletteInput = useRef<HTMLInputElement>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const platformBinding = (command: string) => {
    const binding = extensionHost.getKeybindings().find((item) => item.command === command);
    return /Mac|iPhone|iPad/.test(navigator.platform)
      ? (binding?.mac ?? binding?.key)
      : binding?.key;
  };
  const open = () => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    setPalette(true);
    setShortcuts(false);
    setQuery("");
    setError("");
  };
  const close = () => {
    setPalette(false);
    previousFocus.current?.isConnected && previousFocus.current.focus();
  };
  const run = (command: string) => {
    close();
    setMenu(null);
    void extensionHost.executeCommand(command).catch((cause) => setError(String(cause)));
  };
  useEffect(() => {
    const invoke = () => open();
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing || event.defaultPrevented || event.repeat) return;
      const key = [
        event.ctrlKey && "ctrl",
        event.altKey && "alt",
        event.shiftKey && "shift",
        event.metaKey && "meta",
        event.key === " " ? "space" : event.key.toLowerCase(),
      ]
        .filter(Boolean)
        .join("+");
      if (key === "ctrl+shift+p" || key === "shift+meta+p") {
        if (
          extensionHost
            .getSnapshot()
            .interactions.some((item) => item.kind === "input" || item.kind === "pick")
        )
          return;
        event.preventDefault();
        open();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"], [role="menu"]')) return;
      const inputFocus = Boolean(target?.closest("input,textarea,select,[contenteditable=true]"));
      try {
        const command = extensionHost.resolveKeybinding(
          key,
          /Mac|iPhone|iPad/.test(navigator.platform),
          inputFocus,
        );
        if (command) {
          event.preventDefault();
          void extensionHost.executeCommand(command).catch((cause) => setError(String(cause)));
        }
      } catch {
        /* Modifier-only keys and unsupported physical keys have no binding. */
      }
    };
    const context = (event: MouseEvent) => {
      if (
        !(event.target instanceof HTMLElement) ||
        !event.target.closest('[data-ui="pdf-scroll"]') ||
        !extensionHost.getMenu("reader.context").length
      )
        return;
      event.preventDefault();
      setMenu({
        x: Math.min(event.clientX, window.innerWidth - 260),
        y: Math.min(event.clientY, window.innerHeight - 200),
      });
    };
    const dismiss = () => setMenu(null);
    window.addEventListener("cachalot.commandPalette", invoke);
    window.addEventListener("keydown", keyboard);
    window.addEventListener("contextmenu", context);
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("cachalot.commandPalette", invoke);
      window.removeEventListener("keydown", keyboard);
      window.removeEventListener("contextmenu", context);
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, []);
  useEffect(() => {
    if (palette) paletteInput.current?.focus();
  }, [palette, shortcuts]);
  useEffect(() => {
    if (menu) menuRoot.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
  }, [menu]);
  const commandMenus = extensionHost.getMenu("commandPalette");
  const conditionalCommands = new Set(
    snapshot.extensions
      .flatMap((item) => item.manifest.contributes?.menus ?? [])
      .filter((item) => item.location === "commandPalette")
      .map((item) => item.command),
  );
  const commands = extensionHost
    .getCommands()
    .filter(
      (command) =>
        (!conditionalCommands.has(command.command) ||
          commandMenus.some((item) => item.command.command === command.command)) &&
        (
          text(command.title, i18n.resolvedLanguage) +
          " " +
          text(command.category, i18n.resolvedLanguage) +
          " " +
          command.command
        )
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  const dialog = snapshot.interactions.find(
    (item) => item.kind === "input" || item.kind === "pick",
  );
  return (
    <>
      {palette && (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-[10vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={paletteRoot}
            role="dialog"
            aria-modal="true"
            aria-label={t(shortcuts ? "workbench.shortcuts" : "workbench.commands")}
            className="w-[650px] max-w-[90vw] rounded-xl border border-border bg-white p-4 shadow-xl"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                (event.target as HTMLElement).getAttribute("role") === "option"
              ) {
                event.preventDefault();
                moveOption(paletteRoot.current, event.key);
              }
              if (event.key === "Tab") {
                const controls = [
                  ...paletteRoot.current!.querySelectorAll<HTMLElement>(
                    "input,button:not(:disabled)",
                  ),
                ];
                if (event.shiftKey && document.activeElement === controls[0]) {
                  event.preventDefault();
                  controls.at(-1)?.focus();
                } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
                  event.preventDefault();
                  controls[0]?.focus();
                }
              }
            }}
          >
            <h2 className="mb-3 text-sm font-bold">
              {t(shortcuts ? "workbench.shortcuts" : "workbench.commands")}
            </h2>
            <input
              ref={paletteInput}
              aria-label={t("workbench.search")}
              placeholder={t("workbench.search")}
              className="w-full rounded border border-border p-2"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !shortcuts) {
                  const first = commands.find((command) => command.enabled);
                  if (first) run(first.command);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  paletteRoot.current
                    ?.querySelector<HTMLElement>('[role="option"]:not(:disabled)')
                    ?.focus();
                }
              }}
            />
            <div
              role="listbox"
              aria-label={t("workbench.commands")}
              className="mt-2 max-h-[50vh] overflow-auto"
            >
              {commands.map((command) =>
                shortcuts ? (
                  <div
                    key={command.command}
                    className="flex items-center gap-2 border-b border-border py-2"
                  >
                    <label className="flex-1 text-xs" htmlFor={"shortcut-" + command.command}>
                      {text(command.title, i18n.resolvedLanguage)}
                    </label>
                    <input
                      id={"shortcut-" + command.command}
                      className="w-[150px] rounded border border-border p-1 text-xs"
                      aria-label={
                        t("workbench.keybinding") + " " + text(command.title, i18n.resolvedLanguage)
                      }
                      defaultValue={platformBinding(command.command) ?? ""}
                      onBlur={(event) => {
                        const key = event.target.value.trim();
                        void extensionHost
                          .setKeybinding(command.command, key || null)
                          .catch((cause) => setError(String(cause)));
                      }}
                    />
                    <button
                      className="text-xs text-brand"
                      onClick={() => {
                        void extensionHost
                          .setKeybinding(command.command, null)
                          .then(() => setShortcuts(false))
                          .catch((cause) => setError(String(cause)));
                      }}
                    >
                      {t("workbench.restore")}
                    </button>
                  </div>
                ) : (
                  <button
                    key={command.command}
                    role="option"
                    aria-selected={false}
                    disabled={!command.enabled}
                    className="flex w-full items-center justify-between rounded p-2 text-left text-sm hover:bg-brand-soft focus:bg-brand-soft disabled:opacity-40"
                    onClick={() => run(command.command)}
                  >
                    <span>
                      {command.category && text(command.category, i18n.resolvedLanguage) + ": "}
                      {text(command.title, i18n.resolvedLanguage)}
                    </span>
                    <span className="text-[10px] text-muted">
                      {platformBinding(command.command)}
                    </span>
                  </button>
                ),
              )}
              {!commands.length && <p className="p-3 text-xs text-muted">{t("workbench.empty")}</p>}
            </div>
            <div className="mt-3 flex gap-3">
              <button
                className={ui.secondaryButton}
                onClick={() => setShortcuts((value) => !value)}
              >
                {t(shortcuts ? "workbench.commands" : "workbench.shortcuts")}
              </button>
              <button className={ui.secondaryButton} onClick={close}>
                {t("workbench.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
      {menu && (
        <div
          ref={menuRoot}
          role="menu"
          aria-label={t("workbench.contextMenu")}
          className="fixed z-50 min-w-[220px] rounded border border-border bg-white p-1 shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") setMenu(null);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveOption(menuRoot.current, event.key);
            }
          }}
        >
          {extensionHost.getMenu("reader.context").map(({ command }) => (
            <button
              key={command.command}
              role="menuitem"
              disabled={!command.enabled}
              className="block w-full rounded p-2 text-left text-xs hover:bg-brand-soft disabled:opacity-40"
              onClick={() => run(command.command)}
            >
              {text(command.title, i18n.resolvedLanguage)}
            </button>
          ))}
        </div>
      )}
      {dialog && <InteractionDialog key={dialog.id} item={dialog} />}
      <div
        className="fixed right-4 bottom-4 z-50 flex max-w-[420px] flex-col gap-2"
        aria-live="polite"
      >
        {snapshot.interactions
          .filter((item) => ["information", "warning", "progress"].includes(item.kind))
          .map((item) => (
            <div
              key={item.id}
              className="rounded border border-border bg-white p-3 text-xs shadow-lg"
              role="status"
            >
              <p className="font-bold">{text(item.title, i18n.resolvedLanguage)}</p>
              {item.message && <p className="mt-1">{item.message}</p>}
              {item.kind === "progress" && (
                <progress max={100} value={item.percent} className="mt-2 w-full" />
              )}
              {(item.kind !== "progress" || item.cancellable) && (
                <button
                  className="mt-2 text-brand"
                  onClick={() => extensionHost.interactions.dismiss(item.id)}
                >
                  {t(item.kind === "progress" ? "workbench.cancel" : "workbench.close")}
                </button>
              )}
            </div>
          ))}
        {error && (
          <div role="alert" className="rounded border border-danger bg-white p-3 text-xs">
            {error}
            <button className="ml-3 text-brand" onClick={() => setError("")}>
              {t("workbench.close")}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
