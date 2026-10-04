import { message } from "../domain/messages";
import type { AnalysisProgress, LayoutObservations, PageFacts } from "../domain/analysis";
import type {
  AnalysisSnapshot,
  DocumentSemantics,
  SemanticPageView,
} from "../domain/document-semantics";
import type { DocumentRecord } from "../domain/records";
import { nativeText } from "../domain/page-facts";
import type { AnalysisEngine } from "../infrastructure/analysis/protocol";
import { analysisRepository } from "../infrastructure/analysis/repository";
import { semanticsRepository } from "../infrastructure/analysis/semantics-repository";
import { platform } from "../infrastructure/platform";
import { cacheGeneration } from "../infrastructure/cache-writes";
import { semanticSourcesResolve } from "../infrastructure/analysis/validation";
import { assemblePageSemantics, type PageSemanticFragment } from "./assemble-page-semantics";
import { buildDocumentSemantics, projectSemanticPage } from "./document-semantics";

/** Owns one document's source facts and authoritative semantic snapshots.
 * Engine injection tests lifecycle/races without browser workers or real models. */
export class DocumentAnalysisSession {
  private client?: AnalysisEngine;
  private opening?: Promise<AnalysisEngine>;
  private restoring?: Promise<void>;
  private disposed = false;
  private completed = new Set<number>();
  private facts = new Map<number, PageFacts>();
  private observations = new Map<number, LayoutObservations>();
  private fragments = new Map<number, PageSemanticFragment>();
  private factsJobs = new Map<number, Promise<PageFacts>>();
  private layoutJobs = new Map<number, Promise<SemanticPageView>>();
  private indexed = new Map<string, Promise<void>>();
  private semantics: DocumentSemantics;
  private generations = {
    native: cacheGeneration("native"),
    layout: cacheGeneration("layout"),
    semantics: cacheGeneration("semantics"),
    pageText: cacheGeneration("pageText"),
  };

  constructor(
    private readonly document: DocumentRecord,
    private readonly bytes: Uint8Array,
    private readonly onSnapshot: (snapshot: AnalysisSnapshot) => void,
    private readonly onProgress: (progress: AnalysisProgress) => void,
    private readonly createEngine?: (
      onProgress: (message: string) => void,
    ) => AnalysisEngine | Promise<AnalysisEngine>,
  ) {
    this.semantics = buildDocumentSemantics(document.id, document.pageCount, [], 0);
  }

  private active(): void {
    if (this.disposed) throw new DOMException(message("analysisStopped"), "AbortError");
  }
  private checkPage(page: number): void {
    this.active();
    if (!Number.isInteger(page) || page < 1 || page > this.document.pageCount)
      throw new RangeError("Page outside document");
  }
  private publish(phase: AnalysisProgress["phase"], text: string): void {
    if (!this.disposed)
      this.onProgress({
        phase,
        message: text,
        completed: this.completed.size,
        total: this.document.pageCount,
      });
  }
  private emit(): void {
    if (!this.disposed)
      this.onSnapshot({
        semantics: this.semantics,
        pages: [...this.facts.values()].map((facts) => projectSemanticPage(this.semantics, facts)),
      });
  }
  private rebuild(): void {
    this.semantics = buildDocumentSemantics(
      this.document.id,
      this.document.pageCount,
      [...this.fragments.values()],
      this.semantics.revision + 1,
    );
    this.emit();
  }
  private async engine(): Promise<AnalysisEngine> {
    this.active();
    if (this.client?.isDisposed) {
      this.client = undefined;
      this.opening = undefined;
    }
    if (!this.opening) {
      this.opening = (async () => {
        const progress = (text: string) => this.publish("analyzing", text);
        const engine = this.createEngine
          ? await this.createEngine(progress)
          : new (await import("../infrastructure/analysis/client")).AnalysisClient(progress);
        this.client = engine;
        if (this.disposed) {
          engine.dispose();
          this.active();
        }
        await engine.open(this.document.id, this.bytes);
        this.active();
        return engine;
      })();
    }
    const opening = this.opening;
    try {
      return await opening;
    } catch (error) {
      // Other callers may have already started a fresh worker after the shared
      // failure. An older rejection must not tear down that replacement.
      if (this.opening === opening) {
        this.client?.dispose();
        this.client = undefined;
        this.opening = undefined;
      }
      throw error;
    }
  }

  private initialize(): Promise<void> {
    if (!this.restoring) {
      const job = (async () => {
        const cached = await semanticsRepository.get(this.document.id, this.document.pageCount);
        this.active();
        if (!cached) return;
        const sources = await Promise.all(
          cached.inputs.map(async (input) => ({
            input,
            facts: await analysisRepository.getFacts(this.document.id, input.page),
            observations: input.observationKey
              ? await analysisRepository.getObservations(this.document.id, input.page)
              : null,
          })),
        );
        this.active();
        for (const source of sources) {
          if (!source.facts) continue;
          this.facts.set(source.input.page, source.facts);
          if (source.observations) {
            this.observations.set(source.input.page, source.observations);
            this.completed.add(source.input.page);
          }
          this.fragments.set(
            source.input.page,
            assemblePageSemantics(source.facts, source.observations || undefined),
          );
        }
        // Clearing/extracting a source stage invalidates dependent snapshots. Any
        // still-valid facts/observations remain reusable for the partial rebuild.
        this.semantics = cached;
        if (
          sources.every(
            (source) => source.facts && (!source.input.observationKey || source.observations),
          ) &&
          semanticSourcesResolve(cached, [...this.facts.values()])
        )
          this.emit();
        else this.rebuild();
      })();
      this.restoring = job;
      void job.catch(() => {
        if (this.restoring === job) this.restoring = undefined;
      });
    }
    return this.restoring;
  }

  private indexPage(page: number): Promise<void> {
    const stage = this.observations.has(page) ? "layout" : "native",
      key = `${page}:${stage}`;
    if (!this.indexed.has(key)) {
      const facts = this.facts.get(page)!;
      const text =
        stage === "layout"
          ? projectSemanticPage(this.semantics, facts).plainText
          : nativeText(facts);
      const job = platform.savePageText(this.document.id, page, text, this.generations.pageText);
      this.indexed.set(key, job);
      void job.catch(() => {
        if (this.indexed.get(key) === job) this.indexed.delete(key);
      });
    }
    return this.indexed.get(key)!;
  }

  async getPageFacts(page: number): Promise<PageFacts> {
    this.checkPage(page);
    await this.initialize();
    this.active();
    if (!this.facts.has(page) && !this.factsJobs.has(page)) {
      const job = (async () => {
        const cached = await analysisRepository.getFacts(this.document.id, page);
        const result =
          cached ||
          (await analysisRepository.getLegacyFacts(this.document.id, page)) ||
          (await (await this.engine()).extract(page));
        this.active();
        if (result.documentId !== this.document.id || result.page !== page)
          throw new Error("Extraction source mismatch");
        if (!cached) await analysisRepository.putFacts(result, this.generations.native);
        this.active();
        this.facts.set(page, result);
        this.fragments.set(page, assemblePageSemantics(result));
        this.rebuild();
        await semanticsRepository.put(this.semantics, this.generations.semantics);
        return result;
      })();
      this.factsJobs.set(page, job);
      void job.catch(() => {
        if (this.factsJobs.get(page) === job) this.factsJobs.delete(page);
      });
    }
    const result = this.facts.get(page) || (await this.factsJobs.get(page)!);
    this.active();
    await this.indexPage(page);
    return result;
  }

  async getSemanticPage(page: number): Promise<SemanticPageView> {
    this.checkPage(page);
    const facts = await this.getPageFacts(page);
    if (!this.observations.has(page) && !this.layoutJobs.has(page)) {
      const job = (async () => {
        const cached = await analysisRepository.getObservations(this.document.id, page);
        const result = cached || (await (await this.engine()).detect(page));
        this.active();
        if (!cached) await analysisRepository.putObservations(result, this.generations.layout);
        this.active();
        const fragment = assemblePageSemantics(facts, result);
        this.observations.set(page, result);
        this.fragments.set(page, fragment);
        this.completed.add(page);
        this.rebuild();
        await semanticsRepository.put(this.semantics, this.generations.semantics);
        await this.indexPage(page);
        return projectSemanticPage(this.semantics, facts);
      })();
      this.layoutJobs.set(page, job);
      void job.catch(() => {
        if (this.layoutJobs.get(page) === job) this.layoutJobs.delete(page);
      });
    }
    if (this.layoutJobs.has(page)) await this.layoutJobs.get(page);
    this.active();
    await this.indexPage(page);
    return projectSemanticPage(this.semantics, facts);
  }

  async getDocumentSemantics(): Promise<DocumentSemantics> {
    this.active();
    await this.initialize();
    this.active();
    return this.semantics;
  }

  async start(currentPage: number): Promise<void> {
    const order = [
      currentPage,
      ...Array.from({ length: this.document.pageCount }, (_, index) => index + 1).filter(
        (page) => page !== currentPage,
      ),
    ];
    try {
      this.publish("loading", message("loadingCache"));
      for (const page of order) {
        if (this.disposed) return;
        await this.getPageFacts(page);
      }
      for (const page of order) {
        if (this.disposed) return;
        this.publish(
          "analyzing",
          message("analyzingLayout", {
            completed: this.completed.size,
            total: this.document.pageCount,
          }),
        );
        await this.getSemanticPage(page);
      }
      this.active();
      await semanticsRepository.put(this.semantics, this.generations.semantics);
      this.publish("ready", message("analysisSaved"));
    } catch (error) {
      if (!this.disposed)
        this.publish("error", error instanceof Error ? error.message : String(error));
    }
  }

  dispose(): void {
    this.disposed = true;
    this.client?.dispose();
    this.factsJobs.clear();
    this.layoutJobs.clear();
    this.facts.clear();
    this.observations.clear();
    this.fragments.clear();
    this.indexed.clear();
  }
}
