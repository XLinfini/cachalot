import { useEffect } from "react";
import { extensionHost, onExtensionError } from "../application/extensions/runtime";
import type { Provider } from "../domain/records";
import type { ReaderSelection } from "../domain/reader";

/** Shell-to-host bridge. Keep subscriptions alive beneath the settings overlay;
 * extension restarts and view registration never own the core reader lifetime. */
export function useWorkspaceExtensions(
  documentId: string | null,
  model: Provider | null,
  onSelection: (selection: ReaderSelection | null) => void,
  onError: (error: string) => void,
) {
  useEffect(() => {
    const selectionSubscription = extensionHost.onDidChangeSelection(onSelection);
    const errorSubscription = onExtensionError(onError);
    void extensionHost.start().catch((cause) => onError(String(cause)));
    return () => {
      selectionSubscription.dispose();
      errorSubscription.dispose();
    };
  }, [onSelection, onError]);
  useEffect(() => {
    extensionHost.setActiveDocument(documentId);
  }, [documentId]);
  useEffect(() => {
    extensionHost.setModel(model);
  }, [model]);
}
