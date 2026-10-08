import type { Disposable, ExtensionModule, StatusBarItem, TreeItem, Webview } from "../../sdk";
import type { ExtensionPackage } from "./package";
import { sandboxWorker } from "./sandbox-worker";
import { ExtensionRpc } from "./rpc";
import {
  contribution,
  decorations,
  extensionLabel,
  selection,
  statusProperty,
  treeItems,
} from "./validation";

/** Opaque-origin iframe supplies a CSP-inheriting worker. User code never runs on the UI thread. */
export function sandboxModule(pkg: ExtensionPackage): ExtensionModule {
  const failures = new Set<(error: Error) => void>();
  let cleanup: (() => void) | undefined, shutdown: (() => Promise<void>) | undefined;
  return {
    onDidFail(listener) {
      failures.add(listener);
      return {
        dispose: () => {
          failures.delete(listener);
        },
      };
    },
    async activate(context) {
      if (!pkg.manifest.main) return;
      const frame = document.createElement("iframe");
      frame.setAttribute("sandbox", "allow-scripts");
      frame.hidden = true;
      frame.dataset.extensionRuntime = pkg.id;
      const nonce = crypto.randomUUID().replaceAll("-", "");
      frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'"><script nonce="${nonce}">let worker;addEventListener('message',event=>{if(event.source!==parent||worker)return;worker=new Worker(URL.createObjectURL(new Blob([event.data.source],{type:'text/javascript'})));worker.onerror=event=>parent.postMessage({extensionWorkerError:String(event.message)},'*');worker.postMessage({},event.ports);});<\/script>`;
      const channel = new MessageChannel();
      const resources = new Map<number, Disposable>(),
        statuses = new Map<number, StatusBarItem>(),
        trees = new Map<number, Set<() => void>>(),
        webviews = new Map<number, Webview>();
      const functions = new Map<number, (...args: any[]) => any>(),
        signals = new Map<number, AbortController>();
      const signalListeners = new Set<() => void>();
      let next = 0,
        closed = false,
        lastHeartbeat = Date.now(),
        calls = 0,
        callWindow = Date.now();
      let readyResolve!: () => void, readyReject!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => {
        readyResolve = resolve;
        readyReject = reject;
      });
      let rpc: ExtensionRpc;
      const encode = (value: any): any => {
        if (typeof value === "function") {
          const token = ++next;
          functions.set(token, value);
          return { $fn: token };
        }
        if (value instanceof AbortSignal) {
          const token = ++next;
          const abort = () => {
            rpc.notify("abort", [token]);
            value.removeEventListener("abort", abort);
            signalListeners.delete(remove);
          };
          const remove = () => value.removeEventListener("abort", abort);
          value.addEventListener("abort", abort, { once: true });
          signalListeners.add(remove);
          return { $signal: token, aborted: value.aborted };
        }
        if (value instanceof Uint8Array) return value;
        if (Array.isArray(value)) return value.map(encode);
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              encode(typeof item === "function" ? item.bind(value) : item),
            ]),
          );
        return value;
      };
      const decode = (value: any, tokens?: Set<number>): any => {
        if (value?.$fn)
          return (...args: any[]) => rpc.call("callback", [value.$fn, encode(args)]).then(decode);
        if (value?.$signal) {
          const controller = new AbortController();
          signals.set(value.$signal, controller);
          tokens?.add(value.$signal);
          if (value.aborted) controller.abort();
          return controller.signal;
        }
        if (value instanceof Uint8Array) return value;
        if (Array.isArray(value)) return value.map((item) => decode(item, tokens));
        if (value && typeof value === "object")
          return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, decode(item, tokens)]),
          );
        return value;
      };
      const invoke = new Map<string, (...args: any[]) => unknown>([
        ["globalState.get", context.globalState.get],
        ["globalState.update", context.globalState.update],
        ["configuration.get", context.workspace.getConfiguration().get],
        ["configuration.update", context.workspace.getConfiguration().update],
        ["commands.executeCommand", context.commands.executeCommand],
        ["commands.setContext", context.commands.setContext],
        ["window.showInformationMessage", context.window.showInformationMessage],
        ["window.showWarningMessage", context.window.showWarningMessage],
        ["window.showQuickPick", context.window.showQuickPick],
        ["window.showInputBox", context.window.showInputBox],
        ["window.withProgress", context.window.withProgress],
        ["window.showView", context.window.showView],
        [
          "window.showErrorMessage",
          (message: unknown) => {
            if (typeof message !== "string" || message.length > 10000)
              throw new Error("Invalid extension error message");
            context.window.showErrorMessage(message);
          },
        ],
        ["documents.getPageFacts", context.documents.getPageFacts],
        ["documents.getLayoutObservations", context.documents.getLayoutObservations],
        ["documents.getSemanticPage", context.documents.getSemanticPage],
        ["documents.getDocumentSemantics", context.documents.getDocumentSemantics],
        ["documents.openDocument", context.documents.openDocument],
        ["artifacts.write", context.artifacts.write],
        ["artifacts.read", context.artifacts.read],
        ["artifacts.list", context.artifacts.list],
        ["artifacts.delete", context.artifacts.delete],
        ["artifacts.export", context.artifacts.export],
        ["pdf.inspect", context.pdf.inspect],
        ["pdf.exportRegion", context.pdf.exportRegion],
        ["pdf.resolveResource", context.pdf.resolveResource],
        ["pdf.compose", context.pdf.compose],
        ["reader.openPdfComparison", context.reader.openPdfComparison],
        ["reader.getViewStates", context.reader.getViewStates],
        ["reader.revealPage", context.reader.revealPage],
        ["ocr.reconstructFormulas", context.ocr.reconstructFormulas],
        ["formulas.exportPdf", context.formulas.exportPdf],
        ["lm.getModels", context.lm.getModels],
        ["lm.supportsImages", context.lm.supportsImages],
        ["lm.complete", context.lm.complete],
        ["resources.read", context.resources.read],
      ]);
      const eventSources = new Map<string, (listener: (value: any) => void) => Disposable>([
        ["language", context.localization.onDidChangeLanguage],
        ["document", context.documents.onDidChangeDocument],
        ["activeDocument", context.reader.onDidChangeActiveDocument],
        ["selection", context.reader.onDidChangeSelection],
        ["model", context.lm.onDidChangeActiveModel],
        ["models", context.lm.onDidChangeModels],
        ["readerState", context.reader.onDidChangeViewState],
        ["paneState", context.reader.onDidChangePaneState],
        ["configuration", context.workspace.onDidChangeConfiguration],
      ]);
      const fail = (error: Error) => {
        if (closed) return;
        readyReject(error);
        for (const listener of [...failures]) listener(error);
        cleanup?.();
      };
      rpc = new ExtensionRpc(
        channel.port1,
        async (method, args) => {
          if (context.signal.aborted) throw new DOMException("Extension stopped", "AbortError");
          if (Date.now() - callWindow > 1000) {
            calls = 0;
            callWindow = Date.now();
          }
          if (++calls > 2000) {
            fail(new Error("Extension message rate exceeded"));
            throw new Error("Extension message rate exceeded");
          }
          switch (method) {
            case "ready":
              readyResolve();
              return;
            case "heartbeat":
              lastHeartbeat = Date.now();
              return;
            case "registrationFailed":
              fail(new Error(String(args[0])));
              return;
            case "callback": {
              const handler = functions.get(args[0] as number);
              if (!handler) throw new Error("Released host callback");
              const tokens = new Set<number>();
              try {
                return encode(await handler(...decode(args[1], tokens)));
              } finally {
                for (const token of tokens) signals.delete(token);
              }
            }
            case "invoke": {
              const handler = invoke.get(args[0] as string);
              if (!handler) throw new Error("Unavailable extension SDK method");
              const tokens = new Set<number>();
              try {
                return encode(await handler(...decode(args[1], tokens)));
              } finally {
                for (const token of tokens) signals.delete(token);
              }
            }
            case "abort":
              signals.get(args[0] as number)?.abort();
              signals.delete(args[0] as number);
              return;
            case "register": {
              const token = args[0] as number,
                kind = args[1] as string,
                values = decode(args[2]);
              if (!Number.isSafeInteger(token) || resources.has(token) || resources.size >= 1024)
                throw new Error("Invalid or excessive extension registrations");
              let resource: Disposable;
              switch (kind) {
                case "command":
                  resource = context.commands.registerCommand(values[0], values[1]);
                  break;
                case "background":
                  resource = context.reader.setBackground(values[0]);
                  break;
                case "decorations":
                  resource = context.reader.setDecorations(
                    values[0],
                    values[1],
                    decorations(values[2]),
                  );
                  break;
                case "tool":
                  contribution(values[0], ["preview", "select"]);
                  if (values[0].mode !== "rectangle") throw new Error("Invalid reader tool mode");
                  resource = context.reader.registerInteractionTool({
                    ...values[0],
                    preview: async (...args) => decorations(await values[0].preview(...args)),
                    select: async (...args) => selection(await values[0].select(...args)),
                  });
                  break;
                case "action":
                  contribution(values[0], ["run"]);
                  resource = context.reader.registerSelectionAction(values[0]);
                  break;
                case "hover":
                  resource = context.reader.registerHoverProvider({
                    provideHover: async (...args) => {
                      const result = await values[0].provideHover(...args);
                      if (result !== null && result !== undefined) extensionLabel(result);
                      return result ?? null;
                    },
                  });
                  break;
                case "localization":
                  resource = context.localization.registerResources(values[0]);
                  break;
                case "event": {
                  const source = eventSources.get(values[0]);
                  if (!source) throw new Error("Unknown extension event");
                  resource = source((value) =>
                    rpc.notify("event", [values[0], encode(value), token]),
                  );
                  break;
                }
                case "status": {
                  const item = context.window.createStatusBarItem(values[0], values[1], values[2]);
                  statuses.set(token, item);
                  resource = item;
                  break;
                }
                case "tree": {
                  const listeners = new Set<() => void>();
                  trees.set(token, listeners);
                  resource = context.window.registerTreeDataProvider(values[0], {
                    getChildren: async (parent?: TreeItem) =>
                      treeItems(await values[1].getChildren(parent)),
                    onDidChangeTreeData(listener) {
                      listeners.add(listener);
                      return {
                        dispose: () => {
                          listeners.delete(listener);
                        },
                      };
                    },
                  });
                  break;
                }
                case "webview":
                  resource = context.window.registerWebviewViewProvider(values[0], {
                    resolveWebviewView(webview, view) {
                      const viewToken = ++next;
                      webviews.set(viewToken, webview);
                      const messages = webview.onDidReceiveMessage((value) =>
                        rpc.notify("webviewMessage", [viewToken, encode(value)]),
                      );
                      void values[1]({ token: viewToken, view }).catch((error: Error) =>
                        context.window.showErrorMessage(String(error)),
                      );
                      return {
                        dispose() {
                          messages.dispose();
                          webviews.delete(viewToken);
                          rpc.notify("releaseView", [viewToken]);
                        },
                      };
                    },
                  });
                  break;
                default:
                  throw new Error("Unknown extension registration");
              }
              resources.set(token, resource);
              return;
            }
            case "dispose": {
              const token = args[0] as number;
              resources.get(token)?.dispose();
              resources.delete(token);
              statuses.delete(token);
              trees.delete(token);
              return;
            }
            case "treeChanged":
              for (const listener of trees.get(args[0] as number) || []) listener();
              return;
            case "status": {
              const item = statuses.get(args[0] as number);
              if (!item) return;
              const property = args[1];
              if (property === "show") item.show();
              else if (property === "hide") item.hide();
              else if (property === "text" || property === "tooltip" || property === "command") {
                const value = decode(args[2]);
                statusProperty(property, value);
                item[property] = value;
              } else throw new Error("Invalid status property");
              return;
            }
            case "webviewHtml": {
              const webview = webviews.get(args[0] as number);
              if (webview) {
                if (typeof args[1] !== "string" || args[1].length > 4 * 1024 * 1024)
                  throw new Error("Webview HTML too large");
                webview.html = args[1];
              }
              return;
            }
            case "webviewPost":
              webviews.get(args[0] as number)?.postMessage(decode(args[1]));
              return;
            default:
              throw new Error("Unknown extension host operation");
          }
        },
        fail,
      );
      const workerError = (event: MessageEvent) => {
        if (event.source === frame.contentWindow && event.data?.extensionWorkerError)
          fail(new Error(String(event.data.extensionWorkerError)));
      };
      window.addEventListener("message", workerError);
      const visibility = () => {
        lastHeartbeat = Date.now();
      };
      document.addEventListener("visibilitychange", visibility);
      const watchdog = setInterval(() => {
        if (Date.now() - lastHeartbeat > 6000 && document.visibilityState !== "hidden")
          fail(new Error("Extension worker is not responding"));
      }, 2000);
      let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
      let stopping: Promise<void> | undefined;
      cleanup = () => {
        if (closed) return;
        closed = true;
        readyReject(new DOMException("Extension stopped", "AbortError"));
        clearInterval(watchdog);
        if (shutdownTimer) clearTimeout(shutdownTimer);
        window.removeEventListener("message", workerError);
        document.removeEventListener("visibilitychange", visibility);
        context.signal.removeEventListener("abort", stop);
        for (const remove of signalListeners) remove();
        signalListeners.clear();
        for (const signal of signals.values()) signal.abort();
        signals.clear();
        for (const resource of resources.values()) resource.dispose();
        resources.clear();
        rpc.close();
        frame.remove();
        functions.clear();
      };
      const stop = () => {
        if (closed) return Promise.resolve();
        if (stopping) return stopping;
        stopping = new Promise<void>((resolve) => {
          const finish = () => {
            cleanup?.();
            resolve();
          };
          shutdownTimer = setTimeout(finish, 250);
          void rpc
            .call("deactivate")
            .catch(() => undefined)
            .finally(finish);
        });
        return stopping;
      };
      shutdown = stop;
      context.signal.addEventListener("abort", stop, { once: true });
      context.subscriptions.push({
        dispose: () => {
          void stop();
        },
      });
      frame.addEventListener(
        "load",
        () => {
          const source = new TextDecoder().decode(pkg.files[pkg.manifest.main!]);
          frame.contentWindow!.postMessage(
            {
              source: `${source}\n;(${sandboxWorker.toString()})(typeof cachalotExtension==='undefined'?{}:cachalotExtension);`,
            },
            "*",
            [channel.port2],
          );
        },
        { once: true },
      );
      document.body.append(frame);
      const dependencies: Record<string, unknown> = {};
      for (const id of pkg.manifest.extensionDependencies || []) {
        const dependency = context.extensions.getExtension(id);
        if (dependency)
          dependencies[id] = { manifest: dependency.manifest, exports: dependency.exports };
      }
      const capabilities = pkg.manifest.capabilities;
      const initial = () =>
        encode({
          extension: context.extension,
          language: context.localization.language,
          dependencies,
          activeDocumentId: capabilities.includes("documents.read")
            ? context.reader.activeDocumentId
            : null,
          selection: capabilities.includes("reader.interact") ? context.reader.selection : null,
          viewState: capabilities.includes("documents.read") ? context.reader.viewState : null,
          model: capabilities.includes("lm") ? context.lm.activeModel : null,
        });
      // Keep read-only snapshot properties current even without a plugin event listener.
      for (const [name, source] of eventSources) {
        if (
          name === "document" ||
          name === "configuration" ||
          name === "models" ||
          name === "paneState"
        )
          continue;
        if (
          (name === "activeDocument" || name === "readerState") &&
          !capabilities.includes("documents.read")
        )
          continue;
        if (name === "selection" && !capabilities.includes("reader.interact")) continue;
        if (name === "model" && !capabilities.includes("lm")) continue;
        context.subscriptions.push(
          source((value) => rpc.notify("snapshot", [name, encode(value)])),
        );
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          ready.then(() => rpc.call("activate", [initial()])).then(decode),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("Extension activation timed out")), 15000);
          }),
        ]);
      } catch (error) {
        cleanup();
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    },
    deactivate() {
      return shutdown?.();
    },
  };
}
