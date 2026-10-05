import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { extensionHost } from "../../application/extensions/runtime";
import type { HostedView } from "../../application/extensions/host";
import { Emitter } from "../../application/extensions/events";
import type { Label, TreeDataProvider, TreeItem, ViewHandle, Webview } from "../../sdk";
import { services } from "../../application/services";
import { ui } from "../../sdk/ui/styles";

export const useExtensions = () =>
  useSyncExternalStore(extensionHost.subscribe, extensionHost.getSnapshot);
export function label(value: Label | undefined, language?: string): string {
  return !value ? "" : typeof value === "string" ? value : language === "en" ? value.en : value.zh;
}

function Tree({ provider, parent }: { provider: TreeDataProvider; parent?: TreeItem }) {
  const { i18n } = useTranslation();
  const [items, setItems] = useState<TreeItem[]>([]),
    [expanded, setExpanded] = useState<string[]>([]),
    [revision, setRevision] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void Promise.resolve()
      .then(() => provider.getChildren(parent))
      .then((result) => {
        if (alive) {
          setItems(result);
          setError("");
        }
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    return () => {
      alive = false;
    };
  }, [provider, parent, revision]);
  useEffect(() => {
    const subscription = provider.onDidChangeTreeData?.(() => setRevision((value) => value + 1));
    return () => subscription?.dispose();
  }, [provider]);
  return (
    <div role="tree" className="p-2 text-xs">
      {error && <p role="alert">{error}</p>}
      {items.map((item) => (
        <div
          key={item.id}
          role="treeitem"
          aria-expanded={item.collapsible ? expanded.includes(item.id) : undefined}
        >
          <button
            className="flex w-full gap-2 rounded p-2 text-left hover:bg-brand-soft"
            onClick={() => {
              if (item.collapsible)
                setExpanded((values) =>
                  values.includes(item.id)
                    ? values.filter((id) => id !== item.id)
                    : [...values, item.id],
                );
              if (item.command)
                void extensionHost
                  .executeCommand(item.command.command, ...(item.command.arguments || []))
                  .catch((cause) => setError(String(cause)));
            }}
          >
            {item.collapsible && (expanded.includes(item.id) ? "▾" : "▸")}
            {label(item.label, i18n.resolvedLanguage)}
            <span className="text-muted">{label(item.description, i18n.resolvedLanguage)}</span>
          </button>
          {item.collapsible && expanded.includes(item.id) && (
            <div className="pl-3">
              <Tree provider={provider} parent={item} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
function WebviewContent({ view }: { view: HostedView }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState("");
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const handle = viewHandle(view, controller);
    const messages = new Emitter<unknown>();
    let active = true,
      source = "";
    const webview: Webview = {
      get html() {
        return source;
      },
      set html(value) {
        if (active) {
          source = value;
          setHtml(value);
        }
      },
      postMessage(message) {
        if (active) frame.current?.contentWindow?.postMessage(message, "*");
      },
      onDidReceiveMessage: messages.event,
    };
    const receive = (event: MessageEvent) => {
      if (active && event.source === frame.current?.contentWindow) messages.fire(event.data);
    };
    window.addEventListener("message", receive);
    let subscription: ReturnType<NonNullable<HostedView["webview"]>["resolveWebviewView"]>;
    try {
      setFailure("");
      subscription = view.webview?.resolveWebviewView(webview, handle);
    } catch (cause) {
      setFailure(String(cause));
    }
    return () => {
      controller.abort();
      active = false;
      window.removeEventListener("message", receive);
      subscription?.dispose();
    };
  }, [view.webview, view.instance]);
  // No same-origin, top navigation, forms, popups or fetch access. A view
  // exchanges data solely through its own message handler, not native IPC.
  const policy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'">`;
  if (failure)
    return (
      <p role="alert" className="p-4 text-danger">
        {failure}
      </p>
    );
  return (
    <iframe
      key={html}
      ref={frame}
      title={label(view.declaration.title)}
      sandbox="allow-scripts"
      srcDoc={policy + html}
      className="h-full min-h-[120px] w-full border-0"
    />
  );
}
function viewHandle(view: HostedView, controller: AbortController): ViewHandle {
  return {
    data: view.data,
    signal: AbortSignal.any([controller.signal, view.signal]),
    close() {
      controller.abort();
      extensionHost.hideView(view.declaration.id);
    },
  };
}
export function ExtensionView({ view }: { view: HostedView }) {
  const root = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const handle = viewHandle(view, controller);
    let mounted: ReturnType<NonNullable<HostedView["provider"]>["mount"]> | undefined;
    try {
      if (root.current) mounted = view.provider?.mount(root.current, handle);
    } catch (cause) {
      setFailure(String(cause));
    }
    return () => {
      controller.abort();
      mounted?.dispose();
    };
  }, [view.provider, view.instance]);
  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col"
      data-extension-view={view.declaration.id}
    >
      {failure && (
        <p role="alert" className="p-4 text-danger">
          {failure}
        </p>
      )}
      {view.provider && <div ref={root} className="flex h-full min-h-0 min-w-0 flex-1" />}
      {view.tree && (
        <div className="flex-1 overflow-auto">
          <Tree provider={view.tree} />
        </div>
      )}
      {view.webview && <WebviewContent view={view} />}
    </div>
  );
}
export function ExtensionModals() {
  const snapshot = useExtensions();
  return createPortal(
    snapshot.views
      .filter((view) => view.visible && view.declaration.location === "modal")
      .map((view) => (
        <div key={`${view.declaration.id}:${view.instance}`} className="fixed inset-0 z-20">
          <ExtensionView view={view} />
        </div>
      )),
    document.body,
  );
}
export function ExtensionDock({
  location,
}: {
  location: "sidebar.left" | "sidebar.right" | "panel";
}) {
  const snapshot = useExtensions();
  const { t, i18n } = useTranslation();
  const views = snapshot.views.filter((view) => view.declaration.location === location);
  const [chosen, setChosen] = useState<string | null>(null);
  const visible = views.filter((view) => view.visible);
  const current = visible.find((view) => view.declaration.id === chosen) || visible[0];
  const [extent, setExtent] = useState(location === "panel" ? 220 : 280);
  const extentRef = useRef(extent);
  extentRef.current = extent;
  useEffect(() => {
    let alive = true;
    void services.settings.get(`workbench:${location}:extent`).then((value) => {
      const saved = Number(value);
      if (alive && value && Number.isFinite(saved)) setExtent(Math.min(600, Math.max(160, saved)));
    });
    return () => {
      alive = false;
    };
  }, [location]);
  if (!views.length) return null;
  return (
    <aside
      data-ui="extension-dock"
      data-location={location}
      className={
        location === "panel"
          ? "relative flex flex-none flex-col border-t border-border bg-white"
          : "relative flex flex-none flex-col border-x border-border bg-white"
      }
      style={
        current
          ? location === "panel"
            ? { height: extent, maxHeight: "45vh" }
            : { width: extent, maxWidth: "30vw" }
          : location === "panel"
            ? { height: 34 }
            : { width: 38 }
      }
    >
      {current && (
        <div
          role="separator"
          aria-label={t("extensions.resize")}
          aria-orientation={location === "panel" ? "horizontal" : "vertical"}
          className={
            location === "panel"
              ? "absolute top-0 right-0 left-0 z-10 h-1 cursor-row-resize"
              : location === "sidebar.left"
                ? "absolute top-0 right-0 bottom-0 z-10 w-1 cursor-col-resize"
                : "absolute top-0 bottom-0 left-0 z-10 w-1 cursor-col-resize"
          }
          onPointerDown={(event) => {
            const target = event.currentTarget,
              start = location === "panel" ? event.clientY : event.clientX,
              size = extent;
            target.setPointerCapture(event.pointerId);
            const move = (next: PointerEvent) => {
              const delta = (location === "panel" ? next.clientY : next.clientX) - start;
              setExtent(
                Math.min(600, Math.max(160, size + (location === "sidebar.left" ? delta : -delta))),
              );
            };
            const up = () => {
              target.removeEventListener("pointermove", move);
              target.removeEventListener("pointerup", up);
              target.removeEventListener("pointercancel", up);
              void services.settings
                .set(`workbench:${location}:extent`, String(extentRef.current))
                .catch(() => undefined);
            };
            target.addEventListener("pointermove", move);
            target.addEventListener("pointerup", up);
            target.addEventListener("pointercancel", up);
          }}
        />
      )}
      <div className="flex flex-none flex-wrap gap-1 border-b border-border p-1" role="tablist">
        {views.map((view) => (
          <button
            key={view.declaration.id}
            role="tab"
            aria-selected={view === current}
            title={label(view.declaration.title, i18n.resolvedLanguage)}
            className="rounded px-2 py-1 text-[11px] hover:bg-brand-soft aria-selected:bg-brand-soft"
            onClick={() => {
              extensionHost.showView(view.declaration.id);
              setChosen(view.declaration.id);
            }}
          >
            {current || location === "panel"
              ? label(view.declaration.title, i18n.resolvedLanguage)
              : label(view.declaration.title, i18n.resolvedLanguage).slice(0, 1)}
          </button>
        ))}
        {current && (
          <select
            aria-label={t("extensions.moveView")}
            className="max-w-[100px] min-w-0 text-[10px]"
            value={location}
            onChange={(event) =>
              void extensionHost
                .moveView(
                  current.declaration.id,
                  event.target.value as "sidebar.left" | "sidebar.right" | "panel",
                )
                .catch(() => undefined)
            }
          >
            {(["sidebar.left", "sidebar.right", "panel"] as const).map((value) => (
              <option key={value} value={value}>
                {t(
                  value === "panel"
                    ? "extensions.positions.panel"
                    : value === "sidebar.left"
                      ? "extensions.positions.left"
                      : "extensions.positions.right",
                )}
              </option>
            ))}
          </select>
        )}
        {current && (
          <button
            className={ui.iconButton}
            aria-label={t("extensions.closeView")}
            onClick={() => extensionHost.hideView(current.declaration.id)}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {current && (
        <ExtensionView key={`${current.declaration.id}:${current.instance}`} view={current} />
      )}
    </aside>
  );
}
export function ExtensionStatusBar() {
  const snapshot = useExtensions(),
    { i18n } = useTranslation();
  const items = snapshot.statusItems
    .filter((item) => item.visible)
    .sort((a, b) => b.priority - a.priority);
  if (!items.length) return null;
  return (
    <div
      data-ui="extension-statusbar"
      className="flex h-6 flex-none items-center gap-3 border-t border-border bg-panel px-3 text-[10px]"
    >
      {["left", "right"].map((side) => (
        <div key={side} className={side === "left" ? "flex flex-1 gap-3" : "flex gap-3"}>
          {items
            .filter((item) => item.alignment === side)
            .map((item) => (
              <button
                key={item.id}
                title={label(item.tooltip, i18n.resolvedLanguage)}
                disabled={!item.command}
                onClick={() =>
                  void extensionHost.executeCommand(item.command!).catch(() => undefined)
                }
              >
                {label(item.text, i18n.resolvedLanguage)}
              </button>
            ))}
        </div>
      ))}
    </div>
  );
}
export function ExtensionToolbar() {
  const snapshot = useExtensions(),
    { i18n } = useTranslation();
  return snapshot.extensions
    .filter((item) => item.enabled)
    .flatMap((item) =>
      (item.manifest.contributes?.menus || []).map((menu) => {
        const command = item.manifest.contributes?.commands?.find(
          (value) => value.command === menu.command,
        );
        return (
          command && (
            <button
              key={command.command}
              className={ui.toolbarButton}
              onClick={() =>
                void extensionHost.executeCommand(command.command).catch(() => undefined)
              }
            >
              {label(command.title, i18n.resolvedLanguage)}
            </button>
          )
        );
      }),
    );
}
export function ExtensionSettings() {
  const snapshot = useExtensions(),
    { t, i18n } = useTranslation();
  const [pending, setPending] = useState<string | null>(null),
    [error, setError] = useState("");
  return (
    <main data-ui="settings-main" className="min-w-0 flex-1 overflow-auto p-10">
      <h1 className="mb-3 text-2xl">{t("extensions.title")}</h1>
      <p className="mb-6 text-xs text-muted">{t("extensions.description")}</p>
      {error && (
        <p role="alert" className={ui.formError}>
          {error}
        </p>
      )}
      {snapshot.extensions.map((item) => (
        <section
          key={item.id}
          data-extension-id={item.id}
          className="mb-4 rounded-lg border border-border p-5"
        >
          <div className="flex items-center gap-3">
            <h2 className="flex-1 text-sm font-bold">
              {label(item.manifest.displayName, i18n.resolvedLanguage)}
            </h2>
            {item.builtIn && <span className="text-xs text-muted">{t("extensions.builtIn")}</span>}
            <button
              className={ui.secondaryButton}
              disabled={pending === item.id}
              aria-pressed={item.enabled}
              onClick={() => {
                setPending(item.id);
                setError("");
                void extensionHost
                  .setEnabled(item.id, !item.enabled)
                  .catch((cause) => setError(String(cause)))
                  .finally(() => setPending(null));
              }}
            >
              {t(item.enabled ? "extensions.disable" : "extensions.enable")}
            </button>
          </div>
          <p className="mt-3 text-xs text-muted">
            {label(item.manifest.description, i18n.resolvedLanguage)}
          </p>
          <p className="mt-2 text-[10px] text-muted">
            {item.manifest.version} · {t(`extensions.status.${item.status}`)}
          </p>
          {item.error && (
            <p role="alert" className={ui.formError}>
              {item.error}
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
