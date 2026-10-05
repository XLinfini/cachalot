/** Optional React toolkit. Extension UI mounts only inside its own view root. */
import { useSyncExternalStore, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ExtensionContext, ViewHandle, ViewProvider } from "./index";
export { default as MathMarkdown } from "./MathMarkdown";
export { ui, cx } from "./ui/styles";
export { localizeMessage } from "../i18n/messages";
export function useActiveModel(context: ExtensionContext) {
  return useSyncExternalStore(
    (listener) => {
      const subscription = context.lm.onDidChangeActiveModel(listener);
      return () => subscription.dispose();
    },
    () => (context.signal.aborted ? null : context.lm.activeModel),
  );
}
const roots = new WeakMap<HTMLElement, { root: Root; generation: number }>();
export function reactView(Component: ComponentType<ViewHandle>): ViewProvider {
  return {
    mount(element, view) {
      // React StrictMode can replay a host effect before its deferred cleanup.
      // Reuse that root and let only the final lease destroy it.
      const record = roots.get(element) || { root: createRoot(element), generation: 0 };
      roots.set(element, record);
      const generation = ++record.generation;
      record.root.render(<Component {...view} />);
      return {
        dispose() {
          queueMicrotask(() => {
            if (record.generation === generation) {
              record.root.unmount();
              roots.delete(element);
            }
          });
        },
      };
    },
  };
}

export function useExtensionTranslation(context: ExtensionContext) {
  const language = useSyncExternalStore(
    (listener) => {
      const subscription = context.localization.onDidChangeLanguage(listener);
      return () => subscription.dispose();
    },
    () => context.localization.language,
  );
  return {
    language,
    t: (key: string, values?: Record<string, string | number>) =>
      context.localization.translate(key, values),
  };
}
