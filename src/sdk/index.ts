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
} from "../domain/analysis";
export type {
  DocumentSemantics,
  SemanticPageView,
  SemanticNode,
} from "../domain/document-semantics";
export type { Provider, CompletionInput, DocumentRecord } from "../domain/records";
export type { ReaderSelection, ReaderGesture } from "../domain/reader";
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
import type { CompletionInput, Provider } from "../domain/records";
import type { ReaderGesture, ReaderSelection } from "../domain/reader";

export interface Disposable {
  dispose(): void;
}
export type Event<T> = (listener: (value: T) => void) => Disposable;
export type Label = string | { zh: string; en: string };
export type Capability = "documents.read" | "reader.interact" | "reader.decorate" | "ocr" | "lm";
export type ViewLocation = "sidebar.left" | "sidebar.right" | "panel" | "settings" | "modal";
export interface ExtensionManifest {
  publisher: string;
  name: string;
  version: string;
  displayName: Label;
  description: Label;
  engines: { cachalot: "^0.1.0" };
  activationEvents: ("onStartupFinished" | "onDocumentOpen" | `onCommand:${string}`)[];
  capabilities: Capability[];
  contributes?: {
    commands?: { command: string; title: Label }[];
    menus?: { location: "reader.toolbar"; command: string }[];
    viewsContainers?: {
      id: string;
      title: Label;
      location: "sidebar.left" | "sidebar.right" | "panel";
    }[];
    views?: { id: string; title: Label; location: ViewLocation; container?: string }[];
    configuration?: { key: string; title: Label; description?: Label; default: string }[];
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
  preview(page: SemanticPageView, box: Box): ReaderDecoration[];
  select(page: SemanticPageView, gesture: ReaderGesture): ReaderSelection | null;
}
export interface SelectionAction {
  id: string;
  title: Label;
  icon?: Label;
  when?(selection: ReaderSelection): boolean;
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
    getConfiguration(): {
      get(key: string): Promise<string>;
      update(key: string, value: string): Promise<void>;
    };
  };
  commands: {
    registerCommand(
      id: string,
      handler: (...args: unknown[]) => unknown | Promise<unknown>,
    ): Disposable;
    executeCommand(id: string, ...args: unknown[]): Promise<unknown>;
  };
  window: {
    registerViewProvider(id: string, provider: ViewProvider): Disposable;
    registerTreeDataProvider(id: string, provider: TreeDataProvider): Disposable;
    registerWebviewViewProvider(id: string, provider: WebviewViewProvider): Disposable;
    showView(id: string, data?: unknown): void;
    createStatusBarItem(id: string, alignment?: "left" | "right", priority?: number): StatusBarItem;
    showErrorMessage(message: string): void;
  };
  documents: {
    getPageFacts(documentId: string, page: number): Promise<PageFacts>;
    getLayoutObservations(documentId: string, page: number): Promise<LayoutObservations | null>;
    getSemanticPage(documentId: string, page: number): Promise<SemanticPageView>;
    getDocumentSemantics(documentId: string): Promise<DocumentSemantics>;
    onDidChangeDocument: Event<{ documentId: string; semantics: DocumentSemantics }>;
  };
  reader: {
    readonly activeDocumentId: string | null;
    readonly selection: ReaderSelection | null;
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
      options: { fallback: Provider; supportsImages: boolean; signal?: AbortSignal },
    ): Promise<{ assets: FormulaAsset[]; issues: FormulaPreparationIssue[] }>;
  };
  formulas: { exportPdf(formula: FormulaFragment): Promise<Uint8Array> };
  lm: {
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
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
