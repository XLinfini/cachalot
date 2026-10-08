/** Public extension API, v0.1. Never expose platform, secrets or application services here. */
export type {
  Box,
  BlockKind,
  PageFacts,
  LayoutObservations,
  ContentBlock,
  FormulaFragment,
  FormulaAsset,
  FormulaPreparationIssue,
  HeadingLevel,
  PdfCharacter,
  PdfObject,
} from "../domain/analysis";
export type * from "../domain/pdf-resources";
import type { PdfResource, PdfResourceRef } from "../domain/pdf-resources";
export type {
  DocumentSemantics,
  SemanticPageView,
  SemanticNode,
} from "../domain/document-semantics";
export type {
  Provider,
  CompletionInput,
  DocumentRecord,
  ModelSelection,
  AvailableModel,
} from "../domain/records";
export type { ReaderSelection, ReaderGesture } from "../domain/reader";
export type { SourceRef, ContentSpan, SemanticFormula } from "../domain/document-semantics";
export type * from "../domain/document-workbench";
import type {
  Artifact,
  ArtifactInput,
  DocumentHandle,
  PdfComparisonHandle,
  PdfComparisonOptions,
  PdfComposition,
  PdfPageInfo,
  PdfRegion,
  ReaderAnchor,
} from "../domain/document-workbench";
export { selectionPreview } from "../domain/reader";
export { area, characterText, containsCenter, intersection, union } from "../domain/geometry";
export { message } from "../domain/messages";
export { FORMULA_PATTERN } from "../domain/formula-markers";
import type {
  Box,
  FormulaAsset,
  FormulaFragment,
  FormulaPreparationIssue,
  LayoutObservations,
  PageFacts,
} from "../domain/analysis";
import type { DocumentSemantics, SemanticPageView } from "../domain/document-semantics";
import type { AvailableModel, ModelSelection, CompletionInput, Provider } from "../domain/records";
import type { ReaderGesture, ReaderSelection } from "../domain/reader";

export interface Disposable {
  dispose(): void;
}
export type Event<T> = (listener: (value: T) => void) => Disposable;
export type Label = string | { zh: string; en: string };
export type Capability =
  "documents.read" | "documents.write" | "reader.interact" | "reader.decorate" | "ocr" | "lm";
export type ViewLocation = "sidebar.left" | "sidebar.right" | "panel" | "settings" | "modal";
export type { ContextValue } from "../domain/context-keys";
export type {
  ConfigurationValue,
  ConfigurationDeclaration,
} from "../domain/extension-configuration";
import type { ContextValue } from "../domain/context-keys";
import type {
  ConfigurationValue,
  ConfigurationDeclaration,
} from "../domain/extension-configuration";

export type MenuLocation = "reader.toolbar" | "reader.context" | "view.title" | "commandPalette";
export interface CommandContribution {
  command: string;
  title: Label;
  category?: Label;
  enablement?: string;
}
export interface MenuContribution {
  location: MenuLocation;
  command: string;
  when?: string;
  group?: string;
}
export interface KeybindingContribution {
  command: string;
  key: string;
  mac?: string;
  when?: string;
  allowInInput?: boolean;
}
export interface ConfigurationChangeEvent {
  key: string;
  value: ConfigurationValue;
}
export interface ReaderViewState {
  /** Legacy main-reader events omit this; new pane events always identify their instance. */
  viewId?: string;
  documentId: string;
  page: number;
  pageCount: number;
  zoom: number;
  scrollTop: number;
  viewportHeight: number;
  anchor?: ReaderAnchor;
  cause?: "user" | "navigation";
}
export interface QuickPickItem {
  id: string;
  label: Label;
  description?: Label;
}
export interface InputBoxOptions {
  title: Label;
  prompt?: Label;
  value?: string;
  password?: boolean;
}
export interface ProgressOptions {
  title: Label;
  cancellable?: boolean;
}
export interface Progress {
  report(value: { message?: string; increment?: number }): void;
}

export interface ExtensionManifest {
  publisher: string;
  name: string;
  version: string;
  displayName: Label;
  description: Label;
  engines: { cachalot: string };
  /** Hard dependencies, activated before this extension (VS Code semantics). */
  extensionDependencies?: string[];
  /** Installation group; members remain independently manageable. */
  extensionPack?: string[];
  /** Bundled browser IIFE entry, exporting global cachalotExtension. */
  main?: string;
  activationEvents: ("onStartupFinished" | "onDocumentOpen" | `onCommand:${string}`)[];
  capabilities: Capability[];
  contributes?: {
    commands?: CommandContribution[];
    menus?: MenuContribution[];
    keybindings?: KeybindingContribution[];
    viewsContainers?: {
      id: string;
      title: Label;
      location: "sidebar.left" | "sidebar.right" | "panel";
    }[];
    views?: {
      id: string;
      title: Label;
      location: ViewLocation;
      container?: string;
      when?: string;
    }[];
    configuration?: ConfigurationDeclaration[];
  };
}
export interface ReaderDecoration {
  id: string;
  box: Box;
  kind?: string;
  borderColor: string;
  backgroundColor?: string;
  label?: string;
}
export interface InteractionTool {
  id: string;
  title: Label;
  tooltip?: Label;
  icon?: Label;
  mode: "rectangle";
  preview(page: SemanticPageView, box: Box): ReaderDecoration[] | Promise<ReaderDecoration[]>;
  select(
    page: SemanticPageView,
    gesture: ReaderGesture,
  ): ReaderSelection | null | Promise<ReaderSelection | null>;
}
export interface SelectionAction {
  id: string;
  title: Label;
  icon?: Label;
  when?(selection: ReaderSelection): boolean | Promise<boolean>;
  run(selection: ReaderSelection, signal: AbortSignal): void | Promise<void>;
}
export interface HoverProvider {
  provideHover(
    page: SemanticPageView,
    point: [number, number],
    signal: AbortSignal,
  ): Label | null | Promise<Label | null>;
}
export interface ViewHandle {
  data: unknown;
  signal: AbortSignal;
  close(): void;
}
/** The element is this view's owned content root, never a core DOM node. Only
 * trusted bundled modules run in process. Use sandboxed webviews for HTML UI. */
export interface ViewProvider {
  mount(element: HTMLElement, view: ViewHandle): Disposable;
}
export interface TreeItem {
  id: string;
  label: Label;
  description?: Label;
  collapsible?: boolean;
  command?: { command: string; arguments?: unknown[] };
}
export interface TreeDataProvider {
  onDidChangeTreeData?: Event<void>;
  getChildren(parent?: TreeItem): Promise<TreeItem[]> | TreeItem[];
}
export interface Webview {
  html: string;
  postMessage(message: unknown): void;
  onDidReceiveMessage: Event<unknown>;
}
export interface WebviewViewProvider {
  resolveWebviewView(webview: Webview, view: ViewHandle): void | Disposable;
}
export interface StatusBarItem extends Disposable {
  text: Label;
  tooltip?: Label;
  command?: string;
  show(): void;
  hide(): void;
}
export interface ExtensionContext {
  extension: { id: string; manifest: ExtensionManifest };
  subscriptions: Disposable[];
  signal: AbortSignal;
  extensions: {
    /** APIs are available only for declared hard dependencies. Cross-runtime methods are async. */
    getExtension<T = unknown>(id: string): Extension<T> | undefined;
  };
  /** Read an installed package asset. No access to arbitrary host files. */
  resources: { read(path: string): Promise<Uint8Array> };
  localization: {
    readonly language: "zh" | "en";
    onDidChangeLanguage: Event<"zh" | "en">;
    registerResources(resources: {
      zh: Record<string, unknown>;
      en: Record<string, unknown>;
    }): Disposable;
    translate(key: string, values?: Record<string, string | number>): string;
  };
  globalState: {
    get<T>(key: string, fallback: T): Promise<T>;
    update(key: string, value: unknown): Promise<void>;
  };
  workspace: {
    onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
    getConfiguration(): {
      /** The type parameter is a developer assertion; values are checked against the manifest. */
      get<T = string>(key: string, fallback?: T): Promise<T>;
      update(key: string, value: ConfigurationValue): Promise<void>;
    };
  };
  commands: {
    registerCommand(
      id: string,
      handler: (...args: unknown[]) => unknown | Promise<unknown>,
    ): Disposable;
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
    setContext(key: string, value: ContextValue): Promise<void>;
  };
  window: {
    registerViewProvider(id: string, provider: ViewProvider): Disposable;
    registerTreeDataProvider(id: string, provider: TreeDataProvider): Disposable;
    registerWebviewViewProvider(id: string, provider: WebviewViewProvider): Disposable;
    showView(id: string, data?: unknown): void;
    createStatusBarItem(id: string, alignment?: "left" | "right", priority?: number): StatusBarItem;
    showErrorMessage(message: string): void;
    showInformationMessage(message: string): void;
    showWarningMessage(message: string): void;
    showQuickPick(
      items: QuickPickItem[],
      options?: { title?: Label },
      signal?: AbortSignal,
    ): Promise<QuickPickItem | undefined>;
    showInputBox(options: InputBoxOptions, signal?: AbortSignal): Promise<string | undefined>;
    withProgress<T>(
      options: ProgressOptions,
      task: (progress: Progress, signal: AbortSignal) => Promise<T>,
    ): Promise<T>;
  };
  documents: {
    openDocument(documentId: string, signal?: AbortSignal): Promise<DocumentHandle>;
    getPageFacts(documentId: string, page: number): Promise<PageFacts>;
    getLayoutObservations(documentId: string, page: number): Promise<LayoutObservations | null>;
    getSemanticPage(documentId: string, page: number): Promise<SemanticPageView>;
    getDocumentSemantics(documentId: string): Promise<DocumentSemantics>;
    onDidChangeDocument: Event<{ documentId: string; semantics: DocumentSemantics }>;
  };
  /** Binary user data, scoped to the calling extension. Survives extension restarts/cache clearing. */
  artifacts: {
    write(input: ArtifactInput, signal?: AbortSignal): Promise<Artifact>;
    read(id: string, signal?: AbortSignal): Promise<Uint8Array>;
    list(sourceDocumentId?: string): Promise<Artifact[]>;
    delete(id: string): Promise<void>;
    export(id: string): Promise<void>;
  };
  /** Generic PDF operations execute in a separate computation worker. No translation policy. */
  pdf: {
    resolveResource(
      bytes: Uint8Array,
      ref: PdfResourceRef,
      signal?: AbortSignal,
    ): Promise<PdfResource>;
    inspect(bytes: Uint8Array, signal?: AbortSignal): Promise<PdfPageInfo[]>;
    exportRegion(
      bytes: Uint8Array,
      page: number,
      box: Box,
      signal?: AbortSignal,
    ): Promise<PdfRegion>;
    compose(input: PdfComposition, signal?: AbortSignal): Promise<Uint8Array>;
  };
  reader: {
    openPdfComparison(options: PdfComparisonOptions): Promise<PdfComparisonHandle>;
    getViewStates(): Promise<ReaderViewState[]>;
    onDidChangePaneState: Event<ReaderViewState | null>;
    readonly activeDocumentId: string | null;
    readonly selection: ReaderSelection | null;
    readonly viewState: ReaderViewState | null;
    onDidChangeViewState: Event<ReaderViewState | null>;
    onDidChangeSelection: Event<ReaderSelection | null>;
    onDidChangeActiveDocument: Event<string | null>;
    registerInteractionTool(tool: InteractionTool): Disposable;
    registerSelectionAction(action: SelectionAction): Disposable;
    registerHoverProvider(provider: HoverProvider): Disposable;
    setDecorations(documentId: string, page: number, decorations: ReaderDecoration[]): Disposable;
    setBackground(color: string): Disposable;
    revealPage(documentId: string, page: number): void;
  };
  ocr: {
    reconstructFormulas(
      formulas: FormulaFragment[],
      options: {
        fallback?: Provider;
        supportsImages?: boolean;
        model?: ModelSelection;
        signal?: AbortSignal;
      },
    ): Promise<{ assets: FormulaAsset[]; issues: FormulaPreparationIssue[] }>;
  };
  formulas: { exportPdf(formula: FormulaFragment): Promise<Uint8Array> };
  lm: {
    /** Read the host catalogue when starting an operation or opening a picker; never cache it at activation. */
    getModels(): Promise<AvailableModel[]>;
    onDidChangeModels: Event<void>;
    readonly activeModel: Provider | null;
    onDidChangeActiveModel: Event<Provider | null>;
    supportsImages(model: Provider): Promise<boolean>;
    complete(
      input: CompletionInput,
      onDelta: (delta: string) => void,
      signal?: AbortSignal,
    ): Promise<void>;
  };
}
export interface ExtensionModule {
  activate(context: ExtensionContext): unknown | Promise<unknown>;
  deactivate?(): void | Promise<void>;
  /** Host runtime adapter only; not an extension entry-point export. */
  onDidFail?: Event<Error>;
}
export interface Extension<T = unknown> {
  readonly id: string;
  readonly manifest: ExtensionManifest;
  readonly isActive: boolean;
  readonly exports: T;
  activate(): Promise<T>;
}
