import type {
  Capability,
  Disposable,
  ExtensionContext,
  ExtensionManifest,
  ExtensionModule,
  HoverProvider,
  InteractionTool,
  Label,
  ReaderDecoration,
  ReaderSelection,
  SelectionAction,
  StatusBarItem,
  TreeDataProvider,
  ViewProvider,
  WebviewViewProvider,
} from "../../sdk";
import { Emitter, cancellable, cancelled, disposable } from "./events";
import { validateManifest, extensionId } from "../../infrastructure/extensions/manifest";
import {
  dependencyProblem,
  dependentsFirst,
  type DependencyProblem,
  type DependencyEntry,
} from "./dependencies";
export { extensionId } from "../../infrastructure/extensions/manifest";

export interface ExtensionInstallation {
  manifest: ExtensionManifest;
  /** Supplied by the installation catalog, never by an extension manifest. */
  builtIn: boolean;
  configurationMigrations?: Record<string, string>;
  readResource?(path: string): Promise<Uint8Array>;
  load(): Promise<ExtensionModule>;
}
export interface HostPorts {
  catalog?: { load(): Promise<ExtensionInstallation[]>; remove(ids: string[]): Promise<void> };
  localization?: {
    language(): "zh" | "en";
    onDidChangeLanguage: ExtensionContext["localization"]["onDidChangeLanguage"];
    register(
      id: string,
      resources: { zh: Record<string, unknown>; en: Record<string, unknown> },
    ): Disposable;
    translate(id: string, key: string, values?: Record<string, string | number>): string;
  };
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  documents: Pick<
    ExtensionContext["documents"],
    "getPageFacts" | "getSemanticPage" | "getLayoutObservations" | "getDocumentSemantics"
  >;
  ocr: ExtensionContext["ocr"];
  formulas: ExtensionContext["formulas"];
  lm: Pick<ExtensionContext["lm"], "supportsImages" | "complete">;
  revealPage(documentId: string, page: number): void;
  showError(message: string): void;
}
interface Runtime {
  installation: ExtensionInstallation;
  status: "disabled" | "inactive" | "activating" | "active" | "error" | "blocked";
  enabled: boolean;
  requested?: boolean;
  exports?: unknown;
  problem?: DependencyProblem;
  error?: string;
  controller?: AbortController;
  context?: ExtensionContext;
  module?: ExtensionModule;
  activation?: Promise<void>;
}
export interface HostedView {
  owner: string;
  declaration: NonNullable<ExtensionManifest["contributes"]>["views"] extends
    (infer T)[] | undefined
    ? T
    : never;
  provider?: ViewProvider;
  tree?: TreeDataProvider;
  webview?: WebviewViewProvider;
  visible: boolean;
  data?: unknown;
  instance: number;
  signal: AbortSignal;
}
export interface HostedStatusItem {
  owner: string;
  id: string;
  text: Label;
  tooltip?: Label;
  command?: string;
  visible: boolean;
  alignment: "left" | "right";
  priority: number;
}
export interface HostSnapshot {
  revision: number;
  extensions: {
    id: string;
    manifest: ExtensionManifest;
    builtIn: boolean;
    enabled: boolean;
    status: Runtime["status"];
    error?: string;
    problem?: DependencyProblem;
  }[];
  tools: { owner: string; tool: InteractionTool }[];
  actions: { owner: string; action: SelectionAction }[];
  views: HostedView[];
  statusItems: HostedStatusItem[];
  background?: string;
  decorations: {
    owner: string;
    documentId: string;
    page: number;
    decorations: ReaderDecoration[];
  }[];
}

/** One owner scope per activation. All registrations are automatically tracked,
 * even if an extension forgets to add them to context.subscriptions. */
export class ExtensionHost {
  private runtimes = new Map<string, Runtime>();
  private queues = new Map<string, Promise<unknown>>();
  private commands = new Map<string, { owner: string; run: (...args: unknown[]) => unknown }>();
  private tools = new Map<string, { owner: string; tool: InteractionTool }>();
  private actions = new Map<string, { owner: string; action: SelectionAction }>();
  private views = new Map<string, HostedView>();
  private statuses = new Map<string, HostedStatusItem>();
  private backgrounds = new Map<symbol, string>();
  private decorations = new Map<symbol, HostSnapshot["decorations"][number]>();
  private hoverProviders = new Map<symbol, { owner: string; provider: HoverProvider }>();
  private changes = new Emitter<void>();
  private selections = new Emitter<ReaderSelection | null>();
  private documentsChanged = new Emitter<
    Parameters<Parameters<ExtensionContext["documents"]["onDidChangeDocument"]>[0]>[0]
  >();
  private activeDocuments = new Emitter<string | null>();
  private models = new Emitter<ProviderValue>();
  private _activeDocumentId: string | null = null;
  private _selection: ReaderSelection | null = null;
  private selectionOwner?: string;
  private _model: ProviderValue = null;
  private snapshot: HostSnapshot = {
    revision: 0,
    extensions: [],
    tools: [],
    actions: [],
    views: [],
    statusItems: [],
    decorations: [],
  };
  private started?: Promise<void>;
  private initialized?: Promise<void>;
  private stopped = false;
  constructor(
    installations: ExtensionInstallation[],
    private ports: HostPorts,
  ) {
    for (const installation of installations) this.registerInstallation(installation);
    this.emit();
  }
  /** Privileged installation entry used by the host catalog/developer loader.
   * It is deliberately absent from ExtensionContext. */
  private registerInstallation(input: ExtensionInstallation) {
    const installation = { ...input, manifest: freezeManifest(validateManifest(input.manifest)) };

    const { manifest } = installation,
      id = extensionId(manifest);
    if (!/^[a-z0-9-]+\.[a-z0-9-]+$/.test(id) || this.runtimes.has(id))
      throw new Error(`Invalid or duplicate extension ID: ${id}`);
    const ids = [
      ...(manifest.contributes?.commands?.map((item) => item.command) || []),
      ...(manifest.contributes?.views?.map((item) => item.id) || []),
      ...(manifest.contributes?.viewsContainers?.map((item) => item.id) || []),
    ];
    if (ids.some((value) => !value.startsWith(`${id}.`)) || new Set(ids).size !== ids.length)
      throw new Error(`Invalid contribution IDs: ${id}`);
    for (const view of manifest.contributes?.views || []) {
      if (
        view.container &&
        !manifest.contributes?.viewsContainers?.some(
          (container) => container.id === view.container && container.location === view.location,
        )
      )
        throw new Error(`Invalid view container: ${view.id}`);
    }
    this.runtimes.set(id, { installation, status: "inactive", enabled: true });
    this.emit();
  }
  async install(installation: ExtensionInstallation) {
    return this.installBatch([installation]);
  }
  /** Replace packages together, restarting their consumers without touching core services. */
  async installBatch(installations: ExtensionInstallation[]) {
    await this.initialize();
    await this.enqueue("catalog", async () => {
      const inputs = installations.map((input) => ({
        ...input,
        manifest: validateManifest(input.manifest),
      }));
      const ids = inputs.map((input) => extensionId(input.manifest));
      if (new Set(ids).size !== ids.length)
        throw new Error("Duplicate extension in installation batch");
      for (const id of ids)
        if (this.runtimes.get(id)?.installation.builtIn)
          throw new Error("Built-in extensions cannot be replaced");
      const affected = dependentsFirst(ids, this.dependencyCatalog());
      const requested = new Set(affected.filter((id) => this.runtimes.get(id)?.requested));
      const enabled = new Map<string, boolean>();
      for (const id of ids)
        enabled.set(
          id,
          this.runtimes.get(id)?.enabled ??
            (await this.ports.getSetting(`extensions:${id}:enabled`)) !== "false",
        );
      for (const id of affected) {
        const runtime = this.runtimes.get(id);
        if (runtime) await this.stopRuntime(runtime);
      }
      for (const input of inputs) {
        const id = extensionId(input.manifest);
        this.runtimes.delete(id);
        this.registerInstallation(input);
        const runtime = this.require(id);
        runtime.enabled = enabled.get(id)!;
        runtime.status = runtime.enabled ? "inactive" : "disabled";
        runtime.requested = requested.has(id);
      }
      await this.reconcile(affected);
    });
  }
  getDependents(id: string, enabledOnly = false): string[] {
    return dependentsFirst([id], this.dependencyCatalog()).filter(
      (value) => value !== id && (!enabledOnly || this.require(value).enabled),
    );
  }
  private dependencyCatalog(): Map<string, DependencyEntry> {
    return new Map(
      [...this.runtimes].map(([id, runtime]) => [
        id,
        { manifest: runtime.installation.manifest, enabled: runtime.enabled },
      ]),
    );
  }
  private async reconcile(ids: Iterable<string>) {
    for (const id of ids) {
      const runtime = this.runtimes.get(id);
      if (
        runtime &&
        runtime.enabled &&
        (runtime.requested ||
          runtime.installation.manifest.activationEvents.includes("onStartupFinished") ||
          (this._activeDocumentId &&
            runtime.installation.manifest.activationEvents.includes("onDocumentOpen")))
      )
        await this.activate(id);
    }
    this.emit();
  }
  async restart(id?: string) {
    await this.initialize();
    await this.enqueue("catalog", async () => {
      const affected = dependentsFirst(id ? [id] : this.runtimes.keys(), this.dependencyCatalog());
      for (const value of affected) {
        const runtime = this.runtimes.get(value);
        if (runtime) await this.stopRuntime(runtime);
      }
      await this.reconcile(affected);
    });
  }
  readonly subscribe = (listener: () => void) => {
    const sub = this.changes.event(listener);
    return () => sub.dispose();
  };
  readonly getSnapshot = () => this.snapshot;
  readonly onDidChangeSelection = this.selections.event;
  private emit() {
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      extensions: [...this.runtimes].map(([id, runtime]) => ({
        id,
        manifest: runtime.installation.manifest,
        builtIn: runtime.installation.builtIn,
        enabled: runtime.enabled,
        status: runtime.status,
        error: runtime.error,
        problem: runtime.problem,
      })),
      tools: [...this.tools.values()],
      actions: [...this.actions.values()],
      views: [...this.views.values()].map((view) => ({ ...view })),
      statusItems: [...this.statuses.values()].map((item) => ({ ...item })),
      background: [...this.backgrounds.values()].at(-1),
      decorations: [...this.decorations.values()],
    };
    this.changes.fire();
  }
  private initialize(): Promise<void> {
    return (this.initialized ||= (async () => {
      if (this.ports.catalog) {
        try {
          for (const installation of await this.ports.catalog.load())
            this.registerInstallation(installation);
        } catch (error) {
          this.ports.showError(String(error));
        }
      }
      for (const [id, runtime] of this.runtimes) {
        for (const [key, legacy] of Object.entries(
          runtime.installation.configurationMigrations || {},
        )) {
          const target = `extensions:${id}:config:${key}`;
          if ((await this.ports.getSetting(target)) === null) {
            const value = await this.ports.getSetting(legacy);
            if (value !== null) await this.ports.setSetting(target, value);
          }
        }
        runtime.enabled = (await this.ports.getSetting(`extensions:${id}:enabled`)) !== "false";
        runtime.status = runtime.enabled ? "inactive" : "disabled";
      }
      this.emit();
    })());
  }
  start(): Promise<void> {
    return (this.started ||= this.initialize().then(async () => {
      await Promise.all(
        [...this.runtimes]
          .filter(
            ([, runtime]) =>
              runtime.enabled &&
              runtime.installation.manifest.activationEvents.includes("onStartupFinished"),
          )
          .map(([id]) => this.activate(id)),
      );
    }));
  }
  private enqueue<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) || Promise.resolve()).catch(() => undefined).then(operation);
    this.queues.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }
  async setEnabled(
    id: string,
    enabled: boolean,
    options: { cascade?: boolean } = {},
  ): Promise<void> {
    await this.initialize();
    await this.enqueue("catalog", async () => {
      this.require(id);
      if (!enabled) {
        const consumers = this.getDependents(id, true);
        if (consumers.length && !options.cascade)
          throw new Error(`Enabled dependents: ${consumers.join(", ")}`);
        for (const value of [...consumers, id]) {
          const runtime = this.require(value);
          await this.ports.setSetting(`extensions:${value}:enabled`, "false");
          runtime.enabled = false;
          await this.stopRuntime(runtime);
        }
      } else {
        const seen = new Set<string>();
        const enable = async (value: string) => {
          if (seen.has(value)) return;
          seen.add(value);
          const runtime = this.runtimes.get(value);
          if (!runtime) return;
          for (const dependency of runtime.installation.manifest.extensionDependencies || [])
            await enable(dependency);
          await this.ports.setSetting(`extensions:${value}:enabled`, "true");
          runtime.enabled = true;
        };
        await enable(id);
        await this.activate(id);
        await this.reconcile(dependentsFirst(seen, this.dependencyCatalog()));
      }
      this.emit();
    });
  }
  async uninstall(id: string, options: { cascade?: boolean } = {}): Promise<void> {
    await this.initialize();
    await this.enqueue("catalog", async () => {
      this.require(id);
      const consumers = this.getDependents(id);
      if (consumers.length && !options.cascade)
        throw new Error(`Installed dependents: ${consumers.join(", ")}`);
      const ids = [...consumers, id];
      if (ids.some((value) => this.require(value).installation.builtIn))
        throw new Error("Built-in extensions cannot be uninstalled");
      await this.ports.catalog?.remove(ids);
      for (const value of ids) {
        await this.stopRuntime(this.require(value));
        this.runtimes.delete(value);
      }
      this.emit();
    });
  }
  private require(id: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime) throw new Error(`Unknown extension: ${id}`);
    return runtime;
  }
  private activate(id: string): Promise<void> {
    const runtime = this.require(id);
    if (this.stopped || !runtime.enabled || runtime.status === "active") return Promise.resolve();
    runtime.requested = true;
    const problem = dependencyProblem(id, this.dependencyCatalog());
    if (problem) {
      runtime.status = "blocked";
      runtime.problem = problem;
      runtime.error = undefined;
      this.emit();
      return Promise.resolve();
    }
    if (runtime.status === "activating") return runtime.activation || Promise.resolve();
    runtime.status = "activating";
    runtime.error = undefined;
    runtime.problem = undefined;
    const controller = new AbortController();
    runtime.controller = controller;
    const context = this.createContext(id, runtime, controller);
    runtime.context = context;
    this.emit();
    const job = (async () => {
      try {
        for (const dependency of runtime.installation.manifest.extensionDependencies || []) {
          await cancellable(controller.signal, () => this.activate(dependency));
          if (this.require(dependency).status !== "active") {
            if (runtime.controller === controller) {
              await this.stopRuntime(runtime);
              runtime.status = "blocked";
              runtime.problem = { kind: "failed", path: [id, dependency] };
              this.emit();
            }
            return;
          }
        }
        const module = await cancellable(controller.signal, () => runtime.installation.load());
        if (controller.signal.aborted) cancelled();
        runtime.module = module;
        if (module.onDidFail)
          context.subscriptions.push(
            module.onDidFail((error) => {
              if (runtime.controller !== controller) return;
              void this.failRuntime(id, runtime, controller, error);
            }),
          );
        const exports = await cancellable(controller.signal, () =>
          Promise.resolve(module.activate(context)),
        );
        if (runtime.controller === controller) runtime.exports = exports;
        if (runtime.controller === controller) runtime.status = "active";
      } catch (error) {
        if (runtime.controller !== controller) return;
        await this.stopRuntime(runtime);
        if (!controller.signal.aborted || runtime.enabled) {
          runtime.status = "error";
          runtime.error = String(error);
        }
      }
      this.emit();
    })();
    runtime.activation = job;
    return job;
  }
  private async failRuntime(
    id: string,
    runtime: Runtime,
    controller: AbortController,
    error: Error,
  ) {
    if (runtime.controller !== controller) return;
    const affected = dependentsFirst([id], this.dependencyCatalog());
    const scopes = new Map(affected.map((value) => [value, this.require(value).controller]));
    // Abort every affected scope immediately, before asynchronous cleanup.
    for (const value of affected) scopes.get(value)?.abort();
    for (const value of affected) {
      const current = this.runtimes.get(value);
      if (!current || current.controller !== scopes.get(value)) continue;
      await this.stopRuntime(current);
      if (current.controller || !current.enabled) continue;
      current.status = value === id ? "error" : "blocked";
      current.error = value === id ? String(error) : undefined;
      current.problem = value === id ? undefined : { kind: "failed", path: [value, id] };
    }
    this.emit();
  }
  private async stopRuntime(runtime: Runtime) {
    const controller = runtime.controller;
    runtime.controller = undefined;
    controller?.abort();
    for (const subscription of runtime.context?.subscriptions.splice(0).reverse() || []) {
      try {
        subscription.dispose();
      } catch {
        /* Dispose the remaining resources too. */
      }
    }
    if (runtime.module?.deactivate) {
      try {
        await Promise.race([
          Promise.resolve(runtime.module.deactivate()),
          new Promise<void>((resolve) => setTimeout(resolve, 500)),
        ]);
      } catch (error) {
        runtime.error = String(error);
      }
    }
    runtime.module = undefined;
    runtime.context = undefined;
    runtime.exports = undefined;
    runtime.problem = undefined;
    runtime.activation = undefined;
    runtime.status = runtime.enabled ? "inactive" : "disabled";
  }
  async dispose() {
    this.stopped = true;
    for (const runtime of this.runtimes.values()) await this.stopRuntime(runtime);
    this.emit();
  }
  private createContext(
    id: string,
    runtime: Runtime,
    controller: AbortController,
  ): ExtensionContext {
    const host = this,
      manifest = runtime.installation.manifest,
      subscriptions: Disposable[] = [];
    const capabilities = new Set(manifest.capabilities);
    const active = (capability?: Capability) => {
      if (controller.signal.aborted || this.stopped) cancelled();
      if (capability && !capabilities.has(capability))
        throw new Error(`Capability not declared: ${capability}`);
    };
    const owned = (value: string) => {
      active();
      if (!value.startsWith(`${id}.`))
        throw new Error(`Contribution outside owner namespace: ${value}`);
    };
    const track = (value: Disposable) => {
      const resource = disposable(() => {
        value.dispose();
        const position = subscriptions.indexOf(resource);
        if (position >= 0) subscriptions.splice(position, 1);
      });
      subscriptions.push(resource);
      return resource;
    };
    const event =
      <T>(source: Emitter<T>, capability?: Capability) =>
      (listener: (value: T) => void) => {
        active(capability);
        return track(
          source.event((value) => {
            if (!controller.signal.aborted) listener(value);
          }),
        );
      };
    const call = async <T>(
      capability: Capability,
      signal: AbortSignal | undefined,
      operation: (signal: AbortSignal) => Promise<T>,
    ) => {
      active(capability);
      const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      return cancellable(combined, async () => {
        const result = await operation(combined);
        active(capability);
        return result;
      });
    };
    const scopedKey = (kind: string, key: string) => `extensions:${id}:${kind}:${key}`;
    const registerView = (
      viewId: string,
      part: Pick<HostedView, "provider" | "tree" | "webview">,
    ) => {
      owned(viewId);
      const declaration = manifest.contributes?.views?.find((view) => view.id === viewId);
      if (!declaration || host.views.has(viewId))
        throw new Error(`Undeclared or duplicate view: ${viewId}`);
      const hosted: HostedView = {
        owner: id,
        declaration: { ...declaration },
        ...part,
        visible: declaration.location === "settings",
        instance: 0,
        signal: controller.signal,
      };
      host.views.set(viewId, hosted);
      host.emit();
      if (["sidebar.left", "sidebar.right", "panel"].includes(declaration.location)) {
        void Promise.all([
          host.ports.getSetting(`workbench:views:${viewId}:location`),
          host.ports.getSetting(`workbench:views:${viewId}:visible`),
        ])
          .then(([location, visible]) => {
            if (controller.signal.aborted || host.views.get(viewId) !== hosted) return;
            if (location === "sidebar.left" || location === "sidebar.right" || location === "panel")
              hosted.declaration = {
                ...declaration,
                location,
                container: location === declaration.location ? declaration.container : undefined,
              };
            if (visible !== null && hosted.instance === 0) hosted.visible = visible === "true";
            host.emit();
          })
          .catch(() => undefined);
      }
      return track(
        disposable(() => {
          host.views.delete(viewId);
          host.emit();
        }),
      );
    };
    return {
      extension: { id, manifest },
      subscriptions,
      signal: controller.signal,
      resources: {
        read: async (path) => {
          active();
          if (!runtime.installation.readResource) throw new Error("No installed package resources");
          const bytes = await cancellable(controller.signal, () =>
            runtime.installation.readResource!(path),
          );
          active();
          return bytes;
        },
      },
      extensions: {
        getExtension<T>(dependencyId: string) {
          active();
          if (!manifest.extensionDependencies?.includes(dependencyId))
            throw new Error(`Undeclared extension dependency: ${dependencyId}`);
          const dependency = host.runtimes.get(dependencyId);
          if (!dependency) return undefined;
          return {
            id: dependencyId,
            manifest: dependency.installation.manifest,
            get isActive() {
              active();
              return dependency.status === "active";
            },
            get exports() {
              active();
              if (dependency.status !== "active")
                throw new Error(`Dependency is not active: ${dependencyId}`);
              return dependency.exports as T;
            },
            async activate() {
              active();
              await cancellable(controller.signal, () => host.activate(dependencyId));
              active();
              if (dependency.status !== "active")
                throw new Error(`Dependency is not active: ${dependencyId}`);
              return dependency.exports as T;
            },
          };
        },
      },
      localization: {
        get language() {
          return host.ports.localization?.language() || "zh";
        },
        onDidChangeLanguage: (listener) => {
          active();
          return track(
            host.ports.localization?.onDidChangeLanguage((value) => {
              if (!controller.signal.aborted) listener(value);
            }) || disposable(() => undefined),
          );
        },
        registerResources(resources) {
          active();
          return track(
            host.ports.localization?.register(id, resources) || disposable(() => undefined),
          );
        },
        translate(key, values) {
          return host.ports.localization?.translate(id, key, values) || key;
        },
      },
      globalState: {
        async get<T>(key: string, fallback: T) {
          active();
          const value = await host.ports.getSetting(scopedKey("state", key));
          active();
          try {
            return value === null ? fallback : (JSON.parse(value) as T);
          } catch {
            return fallback;
          }
        },
        async update(key, value) {
          active();
          await host.ports.setSetting(scopedKey("state", key), JSON.stringify(value));
        },
      },
      workspace: {
        getConfiguration: () => ({
          async get(key) {
            active();
            const declaration = manifest.contributes?.configuration?.find(
              (item) => item.key === key,
            );
            if (!declaration) throw new Error(`Undeclared setting: ${key}`);
            const value = await host.ports.getSetting(scopedKey("config", key));
            active();
            return value ?? declaration.default;
          },
          async update(key, value) {
            active();
            if (!manifest.contributes?.configuration?.some((item) => item.key === key))
              throw new Error(`Undeclared setting: ${key}`);
            await host.ports.setSetting(scopedKey("config", key), value);
          },
        }),
      },
      commands: {
        registerCommand(command, run) {
          owned(command);
          if (
            !manifest.contributes?.commands?.some((item) => item.command === command) ||
            host.commands.has(command)
          )
            throw new Error(`Undeclared or duplicate command: ${command}`);
          host.commands.set(command, {
            owner: id,
            run: (...args) => {
              active();
              return run(...args);
            },
          });
          return track(disposable(() => host.commands.delete(command)));
        },
        executeCommand(command, ...args) {
          active();
          return host.executeCommand(command, ...args);
        },
      },
      window: {
        registerViewProvider: (viewId, provider) => registerView(viewId, { provider }),
        registerTreeDataProvider: (viewId, tree) => registerView(viewId, { tree }),
        registerWebviewViewProvider: (viewId, webview) => registerView(viewId, { webview }),
        showView(viewId, data) {
          owned(viewId);
          const view = host.views.get(viewId);
          if (!view || view.owner !== id) throw new Error(`Unavailable view: ${viewId}`);
          view.visible = true;
          view.data = data;
          view.instance++;
          host.emit();
        },
        createStatusBarItem(statusId, alignment = "left", priority = 0) {
          owned(statusId);
          if (host.statuses.has(statusId)) throw new Error(`Duplicate status item: ${statusId}`);
          const state: HostedStatusItem = {
            owner: id,
            id: statusId,
            text: "",
            visible: false,
            alignment,
            priority,
          };
          host.statuses.set(statusId, state);
          const resource = track(
            disposable(() => {
              host.statuses.delete(statusId);
              host.emit();
            }),
          );
          const item: StatusBarItem = {
            get text() {
              return state.text;
            },
            set text(value) {
              active();
              state.text = value;
              host.emit();
            },
            get tooltip() {
              return state.tooltip;
            },
            set tooltip(value) {
              active();
              state.tooltip = value;
              host.emit();
            },
            get command() {
              return state.command;
            },
            set command(value) {
              active();
              state.command = value;
              host.emit();
            },
            show() {
              active();
              state.visible = true;
              host.emit();
            },
            hide() {
              active();
              state.visible = false;
              host.emit();
            },
            dispose: resource.dispose,
          };
          return item;
        },
        showErrorMessage(message) {
          active();
          host.ports.showError(message);
        },
      },
      documents: {
        getPageFacts: (documentId, page) =>
          call("documents.read", undefined, () =>
            host.ports.documents.getPageFacts(documentId, page),
          ),
        getLayoutObservations: (documentId, page) =>
          call("documents.read", undefined, () =>
            host.ports.documents.getLayoutObservations(documentId, page),
          ),
        getSemanticPage: (documentId, page) =>
          call("documents.read", undefined, () =>
            host.ports.documents.getSemanticPage(documentId, page),
          ),
        getDocumentSemantics: (documentId) =>
          call("documents.read", undefined, () =>
            host.ports.documents.getDocumentSemantics(documentId),
          ),
        onDidChangeDocument: event(host.documentsChanged, "documents.read"),
      },
      reader: {
        get activeDocumentId() {
          active("documents.read");
          return host._activeDocumentId;
        },
        get selection() {
          active("reader.interact");
          return host._selection;
        },
        onDidChangeSelection: event(host.selections, "reader.interact"),
        onDidChangeActiveDocument: event(host.activeDocuments, "documents.read"),
        registerInteractionTool(tool) {
          active("reader.interact");
          owned(tool.id);
          if (host.tools.has(tool.id)) throw new Error(`Duplicate reader tool: ${tool.id}`);
          const guard: InteractionTool = {
            ...tool,
            preview: (page, box) => (controller.signal.aborted ? [] : tool.preview(page, box)),
            select: (page, gesture) =>
              controller.signal.aborted ? null : tool.select(page, gesture),
          };
          host.tools.set(tool.id, { owner: id, tool: guard });
          host.emit();
          return track(
            disposable(() => {
              host.tools.delete(tool.id);
              if (host.selectionOwner === id) host.publishSelection(null);
              host.emit();
            }),
          );
        },
        registerSelectionAction(action) {
          active("reader.interact");
          owned(action.id);
          if (host.actions.has(action.id)) throw new Error(`Duplicate reader action: ${action.id}`);
          host.actions.set(action.id, {
            owner: id,
            action: {
              ...action,
              when: (selection) => !controller.signal.aborted && (action.when?.(selection) ?? true),
              run: (selection, signal) => {
                active("reader.interact");
                return action.run(selection, signal);
              },
            },
          });
          host.emit();
          return track(
            disposable(() => {
              host.actions.delete(action.id);
              host.emit();
            }),
          );
        },
        registerHoverProvider(provider) {
          active("reader.interact");
          const key = Symbol();
          host.hoverProviders.set(key, { owner: id, provider });
          return track(disposable(() => host.hoverProviders.delete(key)));
        },
        setDecorations(documentId, page, decorations) {
          active("reader.decorate");
          const key = Symbol();
          host.decorations.set(key, { owner: id, documentId, page, decorations });
          host.emit();
          return track(
            disposable(() => {
              host.decorations.delete(key);
              host.emit();
            }),
          );
        },
        setBackground(color) {
          active("reader.decorate");
          if (!/^(#[0-9a-f]{3,8}|[a-z]+|(?:rgb|hsl)a?\([\d\s.,%]+\))$/i.test(color))
            throw new Error("Invalid reader color");
          const key = Symbol(id);
          host.backgrounds.set(key, color);
          host.emit();
          return track(
            disposable(() => {
              host.backgrounds.delete(key);
              host.emit();
            }),
          );
        },
        revealPage(documentId, page) {
          active("reader.interact");
          host.ports.revealPage(documentId, page);
        },
      },
      ocr: {
        reconstructFormulas: (formulas, options) =>
          call("ocr", options.signal, (signal) =>
            host.ports.ocr.reconstructFormulas(formulas, { ...options, signal }),
          ),
      },
      formulas: {
        exportPdf: (formula) =>
          call("documents.read", undefined, () => host.ports.formulas.exportPdf(formula)),
      },
      lm: {
        get activeModel() {
          active("lm");
          return host._model;
        },
        onDidChangeActiveModel: event(host.models, "lm"),
        supportsImages: (model) => call("lm", undefined, () => host.ports.lm.supportsImages(model)),
        complete: (input, onDelta, signal) =>
          call("lm", signal, (combined) =>
            host.ports.lm.complete(
              input,
              (delta) => {
                if (!combined.aborted) onDelta(delta);
              },
              combined,
            ),
          ),
      },
    };
  }
  async executeCommand(command: string, ...args: unknown[]) {
    const registered = this.commands.get(command);
    if (registered) return registered.run(...args);
    await this.initialize();
    const declared = [...this.runtimes].find(([, runtime]) =>
      runtime.installation.manifest.contributes?.commands?.some((item) => item.command === command),
    );
    if (declared && declared[1].enabled) await this.activate(declared[0]);
    const entry = this.commands.get(command);
    if (!entry) throw new Error(`Unavailable command: ${command}`);
    return entry.run(...args);
  }
  async runAction(owner: string, action: SelectionAction, selection: ReaderSelection) {
    const runtime = this.require(owner);
    if (!runtime.controller || runtime.controller.signal.aborted || runtime.status !== "active")
      cancelled();
    const signal = runtime.controller.signal;
    return cancellable(signal, async () => {
      await action.run(selection, signal);
    });
  }
  publishSelection(selection: ReaderSelection | null, owner?: string) {
    this._selection = selection;
    this.selectionOwner = owner;
    this.selections.fire(selection);
  }
  setActiveDocument(documentId: string | null) {
    if (documentId === this._activeDocumentId) return;
    this._activeDocumentId = documentId;
    this.publishSelection(null);
    for (const view of this.views.values())
      if (view.declaration.location === "modal") view.visible = false;
    this.activeDocuments.fire(documentId);
    this.emit();
    if (documentId)
      void this.start()
        .then(async () => {
          for (const [id, runtime] of this.runtimes)
            if (
              runtime.enabled &&
              runtime.installation.manifest.activationEvents.includes("onDocumentOpen")
            )
              await this.enqueue(id, () => this.activate(id));
        })
        .catch((error) => this.ports.showError(String(error)));
  }
  publishDocument(documentId: string, semantics: import("../../sdk").DocumentSemantics) {
    this.documentsChanged.fire({ documentId, semantics });
  }
  setModel(model: ProviderValue) {
    if (JSON.stringify(model) === JSON.stringify(this._model)) return;
    this._model = model;
    this.models.fire(model);
  }
  showView(id: string, data?: unknown) {
    const view = this.views.get(id);
    if (view) {
      view.visible = true;
      if (data !== undefined) {
        view.data = data;
        view.instance++;
      }
      this.saveVisibility(view);
      this.emit();
    }
  }
  async moveView(id: string, location: "sidebar.left" | "sidebar.right" | "panel") {
    const view = this.views.get(id);
    if (!view || !["sidebar.left", "sidebar.right", "panel"].includes(view.declaration.location))
      return;
    await this.ports.setSetting(`workbench:views:${id}:location`, location);
    if (this.views.get(id) === view) {
      view.declaration = { ...view.declaration, location, container: undefined };
      this.emit();
    }
  }
  private saveVisibility(view: HostedView) {
    if (["sidebar.left", "sidebar.right", "panel"].includes(view.declaration.location))
      void this.ports
        .setSetting(`workbench:views:${view.declaration.id}:visible`, String(view.visible))
        .catch((error) => this.ports.showError(String(error)));
  }
  hideView(id: string) {
    const view = this.views.get(id);
    if (view) {
      view.visible = false;
      this.saveVisibility(view);
      this.emit();
    }
  }
  async hover(
    page: import("../../sdk").SemanticPageView,
    point: [number, number],
    signal: AbortSignal,
  ): Promise<Label | null> {
    for (const { owner, provider } of this.hoverProviders.values()) {
      const runtime = this.require(owner);
      if (!runtime.controller || runtime.controller.signal.aborted) continue;
      const combined = AbortSignal.any([signal, runtime.controller.signal]);
      const value = await cancellable(combined, () =>
        Promise.resolve(provider.provideHover(page, point, combined)),
      );
      if (value) return value;
    }
    return null;
  }
}
type ProviderValue = ExtensionContext["lm"]["activeModel"];

function freezeManifest<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeManifest(child);
    Object.freeze(value);
  }
  return value;
}
