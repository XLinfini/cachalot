import type { ExtensionModule } from "../../sdk";
/** Self contained: serialized after TypeScript compilation, then run only inside an opaque-origin worker. */
export function sandboxWorker(module: ExtensionModule) {
  type Any = any;
  let port: MessagePort,
    sequence = 0,
    alive = true;
  const pending = new Map<number, { resolve(value: Any): void; reject(error: Error): void }>();
  const functions = new Map<number, (...args: Any[]) => Any>();
  const abortListeners = new Map<number, () => void>();
  const signals = new Map<number, AbortController>();
  const disposals = new Map<number, () => void>();
  const registrations = new Set<Promise<unknown>>();
  const lifetime = new AbortController();
  let registrationError: unknown;
  let context: Any;
  const state: Any = {};
  const events = new Map<number, (value: Any) => void>();
  const webviews = new Map<number, Any>();
  const encode = (value: Any, tokens?: Set<number>): Any => {
    if (typeof value === "function") {
      const id = ++sequence;
      functions.set(id, value);
      tokens?.add(id);
      return { $fn: id };
    }
    if (value instanceof AbortSignal) {
      const id = ++sequence;
      const abort = () => notify("abort", [id]);
      value.addEventListener("abort", abort, { once: true });
      abortListeners.set(id, () => value.removeEventListener("abort", abort));
      tokens?.add(id);
      return { $signal: id, aborted: value.aborted };
    }
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value)) return value.map((item) => encode(item, tokens));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          encode(typeof item === "function" ? item.bind(value) : item, tokens),
        ]),
      );
    return value;
  };
  const decode = (value: Any): Any => {
    if (value?.$fn)
      return (...args: Any[]) => {
        const tokens = new Set<number>();
        return call("callback", [value.$fn, encode(args, tokens)])
          .then(decode)
          .finally(() => releaseTokens(tokens));
      };
    if (value?.$signal) {
      const controller = new AbortController();
      signals.set(value.$signal, controller);
      if (value.aborted) controller.abort();
      return controller.signal;
    }
    if (value instanceof Uint8Array) return value;
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]));
    return value;
  };
  const notify = (method: string, args: Any[] = []) => {
    if (alive) port.postMessage({ method, args });
  };
  const call = (method: string, args: Any[] = []): Promise<Any> => {
    if (!alive) return Promise.reject(new DOMException("Extension stopped", "AbortError"));
    if (pending.size >= 256) return Promise.reject(new Error("Too many pending extension calls"));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage({ id, method, args });
    });
  };
  const releaseTokens = (tokens: Set<number>) => {
    for (const token of tokens) {
      functions.delete(token);
      abortListeners.get(token)?.();
      abortListeners.delete(token);
    }
  };
  const invoke = (path: string, ...args: Any[]) => {
    const tokens = new Set<number>();
    return call("invoke", [path, encode(args, tokens)])
      .then(decode)
      .finally(() => releaseTokens(tokens));
  };
  const queue = (promise: Promise<unknown>) => {
    registrations.add(promise);
    promise
      .catch((error) => {
        registrationError = error;
        notify("registrationFailed", [String(error)]);
      })
      .finally(() => registrations.delete(promise));
  };
  const resource = (kind: string, ...args: Any[]) => {
    const token = ++sequence;
    const tokens = new Set<number>();
    queue(call("register", [token, kind, encode(args, tokens)]));
    let disposed = false;
    return {
      token,
      dispose() {
        if (!disposed) {
          disposed = true;
          notify("dispose", [token]);
          releaseTokens(tokens);
        }
      },
    };
  };
  const event = (name: string) => (listener: (value: Any) => void) => {
    const subscription = resource("event", name);
    events.set(subscription.token, listener);
    return {
      dispose() {
        events.delete(subscription.token);
        subscription.dispose();
      },
    };
  };
  const translate = (key: string, values: Record<string, string | number> = {}) => {
    let result: Any = state.resources?.[state.language];
    for (const part of key.split(".")) result = result?.[part];
    return typeof result === "string"
      ? result.replace(/{{\s*(\w+)\s*}}/g, (_, name) => String(values[name] ?? ""))
      : key;
  };
  function createContext(initial: Any) {
    Object.assign(state, decode(initial));
    context = {
      extension: state.extension,
      subscriptions: [],
      signal: lifetime.signal,
      extensions: {
        getExtension(id: string) {
          if (!state.extension.manifest.extensionDependencies?.includes(id))
            throw new Error(`Undeclared extension dependency: ${id}`);
          const dependency = state.dependencies[id];
          if (!dependency) return undefined;
          return {
            id,
            manifest: dependency.manifest,
            get isActive() {
              return true;
            },
            get exports() {
              return dependency.exports;
            },
            async activate() {
              return dependency.exports;
            },
          };
        },
      },
      globalState: {
        get: (key: string, fallback: Any) => invoke("globalState.get", key, fallback),
        update: (key: string, value: Any) => invoke("globalState.update", key, value),
      },
      workspace: {
        getConfiguration: () => ({
          get: (key: string) => invoke("configuration.get", key),
          update: (key: string, value: string) => invoke("configuration.update", key, value),
        }),
      },
      localization: {
        get language() {
          return state.language;
        },
        onDidChangeLanguage: event("language"),
        translate,
        registerResources(resources: Any) {
          state.resources = resources;
          return resource("localization", resources);
        },
      },
      commands: {
        registerCommand: (id: string, handler: Any) => resource("command", id, handler),
        executeCommand: (id: string, ...args: Any[]) =>
          invoke("commands.executeCommand", id, ...args),
      },
      window: {
        registerViewProvider() {
          throw new Error(
            "Installed extensions use TreeDataProvider or WebviewViewProvider; direct DOM views are bundled-only",
          );
        },
        registerTreeDataProvider(id: string, provider: Any) {
          const registration = resource("tree", id, {
            getChildren: provider.getChildren.bind(provider),
          });
          const changed = provider.onDidChangeTreeData?.(() =>
            notify("treeChanged", [registration.token]),
          );
          return {
            dispose() {
              changed?.dispose();
              registration.dispose();
            },
          };
        },
        registerWebviewViewProvider(id: string, provider: Any) {
          return resource("webview", id, async (handle: Any) => {
            let html = "";
            const listeners = new Set<(value: Any) => void>();
            const webview = {
              get html() {
                return html;
              },
              set html(value: string) {
                html = value;
                notify("webviewHtml", [handle.token, value]);
              },
              postMessage(value: Any) {
                notify("webviewPost", [handle.token, encode(value)]);
              },
              onDidReceiveMessage(listener: Any) {
                listeners.add(listener);
                return {
                  dispose() {
                    listeners.delete(listener);
                  },
                };
              },
            };
            webviews.set(handle.token, { listeners });
            const release = provider.resolveWebviewView(webview, handle.view);
            disposals.set(handle.token, () => {
              release?.dispose();
              webviews.delete(handle.token);
            });
          });
        },
        showView(id: string, data: Any) {
          queue(invoke("window.showView", id, data));
        },
        showErrorMessage(message: string) {
          queue(invoke("window.showErrorMessage", message));
        },
        createStatusBarItem(id: string, alignment: string = "left", priority = 0) {
          const handle = resource("status", id, alignment, priority),
            properties: Any = { text: "" };
          const item: Any = {
            dispose: handle.dispose,
            show() {
              notify("status", [handle.token, "show"]);
            },
            hide() {
              notify("status", [handle.token, "hide"]);
            },
          };
          for (const property of ["text", "tooltip", "command"])
            Object.defineProperty(item, property, {
              get: () => properties[property],
              set(value) {
                properties[property] = value;
                notify("status", [handle.token, property, encode(value)]);
              },
            });
          return item;
        },
      },
      documents: {
        getPageFacts: (...args: Any[]) => invoke("documents.getPageFacts", ...args),
        getLayoutObservations: (...args: Any[]) =>
          invoke("documents.getLayoutObservations", ...args),
        getSemanticPage: (...args: Any[]) => invoke("documents.getSemanticPage", ...args),
        getDocumentSemantics: (...args: Any[]) => invoke("documents.getDocumentSemantics", ...args),
        onDidChangeDocument: event("document"),
      },
      reader: {
        get activeDocumentId() {
          if (!state.extension.manifest.capabilities.includes("documents.read"))
            throw new Error("Capability not declared: documents.read");
          return state.activeDocumentId;
        },
        get selection() {
          if (!state.extension.manifest.capabilities.includes("reader.interact"))
            throw new Error("Capability not declared: reader.interact");
          return state.selection;
        },
        onDidChangeActiveDocument: event("activeDocument"),
        onDidChangeSelection: event("selection"),
        registerInteractionTool: (tool: Any) => resource("tool", tool),
        registerSelectionAction: (action: Any) => resource("action", action),
        registerHoverProvider: (provider: Any) => resource("hover", provider),
        setDecorations: (...args: Any[]) => resource("decorations", ...args),
        setBackground: (color: string) => resource("background", color),
        revealPage(...args: Any[]) {
          queue(invoke("reader.revealPage", ...args));
        },
      },
      ocr: { reconstructFormulas: (...args: Any[]) => invoke("ocr.reconstructFormulas", ...args) },
      formulas: { exportPdf: (...args: Any[]) => invoke("formulas.exportPdf", ...args) },
      lm: {
        get activeModel() {
          if (!state.extension.manifest.capabilities.includes("lm"))
            throw new Error("Capability not declared: lm");
          return state.model;
        },
        onDidChangeActiveModel: event("model"),
        supportsImages: (...args: Any[]) => invoke("lm.supportsImages", ...args),
        complete: (...args: Any[]) => invoke("lm.complete", ...args),
      },
      resources: { read: (path: string) => invoke("resources.read", path) },
    };
    return context;
  }
  self.onmessage = (event) => {
    port = event.ports[0];
    port.onmessage = async (event) => {
      const message = event.data;
      if (message.response) {
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        if (message.error) item.reject(new Error(message.error));
        else item.resolve(message.value);
        return;
      }
      try {
        let value: Any;
        const args = message.args;
        switch (message.method) {
          case "activate":
            if (typeof module?.activate !== "function")
              throw new Error("Extension entry must export activate(context)");
            value = await module.activate(createContext(args[0]));
            while (registrations.size) await Promise.all([...registrations]);
            if (registrationError) throw registrationError;
            value = encode(value);
            break;
          case "callback": {
            const handler = functions.get(args[0]);
            if (!handler) throw new Error("Released extension callback");
            value = encode(await handler(...decode(args[1])));
            break;
          }
          case "abort":
            signals.get(args[0])?.abort();
            signals.delete(args[0]);
            break;
          case "snapshot":
          case "event":
            if (args[0] === "language") state.language = args[1];
            if (args[0] === "activeDocument") state.activeDocumentId = args[1];
            if (args[0] === "selection") state.selection = args[1];
            if (args[0] === "model") state.model = args[1];
            if (message.method === "event") events.get(args[2])?.(decode(args[1]));
            break;
          case "webviewMessage":
            for (const listener of webviews.get(args[0])?.listeners || [])
              listener(decode(args[1]));
            break;
          case "releaseView":
            disposals.get(args[0])?.();
            disposals.delete(args[0]);
            break;
          case "deactivate":
            lifetime.abort();
            await module.deactivate?.();
            alive = false;
            break;
          default:
            throw new Error("Unknown host message");
        }
        if (message.id) port.postMessage({ id: message.id, response: true, value });
      } catch (error) {
        if (message.id) port.postMessage({ id: message.id, response: true, error: String(error) });
        else notify("registrationFailed", [String(error)]);
      }
    };
    port.start();
    self.addEventListener("unhandledrejection", (event) => {
      event.preventDefault();
      notify("registrationFailed", [String(event.reason)]);
    });
    setInterval(() => notify("heartbeat"), 1000);
    notify("ready");
  };
}
