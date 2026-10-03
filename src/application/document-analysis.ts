import { message } from "../domain/messages";
import type { AnalysisProgress, PageAnalysis } from "../domain/analysis";
import type { DocumentRecord } from "../domain/records";
import { ANALYSIS_CACHE_KEY, NATIVE_CACHE_KEY } from "../domain/model";
import { AnalysisClient } from "../infrastructure/analysis/client";
import { analysisRepository } from "../infrastructure/analysis/repository";
import { platform } from "../infrastructure/platform";
import { cacheGeneration } from "../infrastructure/cache-writes";

/** Per-document lifecycle. Replacing React does not change this service. */
export class DocumentAnalysisSession {
  private client?: AnalysisClient;
  private opening?: Promise<void>;
  private disposed = false;
  private completed = new Set<number>();
  private native = new Map<number, Promise<PageAnalysis>>();
  private full = new Map<number, Promise<PageAnalysis>>();
  private progress: AnalysisProgress;
  private generations = { native: cacheGeneration("native"), layout: cacheGeneration("layout"), pageText: cacheGeneration("pageText") };

  constructor(private readonly document: DocumentRecord, private readonly bytes: Uint8Array,
    private readonly onPage: (page: PageAnalysis) => void, private readonly onProgress: (progress: AnalysisProgress) => void) {
    this.progress = { phase: "loading", completed: 0, total: document.pageCount, message: message("loadingCache") };
  }

  private publish(phase: AnalysisProgress["phase"], message: string): void {
    if (this.disposed) return;
    this.progress = { phase, message, completed: this.completed.size, total: this.document.pageCount };
    this.onProgress(this.progress);
  }

  private async engine(): Promise<AnalysisClient> {
    if (this.disposed) throw new DOMException(message("analysisStopped"), "AbortError");
    if (!this.client || this.client.isDisposed) {
      this.client = new AnalysisClient(message => this.publish("analyzing", message));
      this.opening = this.client.open(this.document.id, this.bytes);
    }
    try { await this.opening; }
    catch (error) {
      this.client.dispose();
      this.client = undefined;
      this.opening = undefined;
      throw error;
    }
    return this.client;
  }

  async getNativePage(page: number): Promise<PageAnalysis> {
    if (!this.native.has(page)) {
      const job = (async () => {
        const cached = await analysisRepository.get(this.document.id, page, ANALYSIS_CACHE_KEY)
          || await analysisRepository.get(this.document.id, page, NATIVE_CACHE_KEY);
        const result = cached || await (await this.engine()).extract(page);
        if (this.disposed) throw new DOMException(message("analysisStopped"), "AbortError");
        if (!cached) await analysisRepository.put(result, this.generations.native);
        await platform.savePageText(this.document.id, page, result.plainText, this.generations.pageText);
        if (!this.disposed) this.onPage(result);
        return result;
      })();
      this.native.set(page, job);
      void job.catch(() => { this.native.delete(page); });
    }
    return this.native.get(page)!;
  }

  async getPage(page: number): Promise<PageAnalysis> {
    if (!this.full.has(page)) {
      const job = (async () => {
        const cached = await analysisRepository.get(this.document.id, page, ANALYSIS_CACHE_KEY);
        const result = cached || await (await this.engine()).analyze(page, await this.getNativePage(page));
        if (this.disposed) throw new DOMException(message("analysisStopped"), "AbortError");
        if (!cached) await analysisRepository.put(result, this.generations.layout);
        await platform.savePageText(this.document.id, page, result.plainText, this.generations.pageText);
        this.completed.add(page);
        if (!this.disposed) this.onPage(result);
        return result;
      })();
      this.full.set(page, job);
      void job.catch(() => { this.full.delete(page); });
    }
    return this.full.get(page)!;
  }

  async start(currentPage: number): Promise<void> {
    const order = [currentPage, ...Array.from({ length: this.document.pageCount }, (_, i) => i + 1).filter(page => page !== currentPage)];
    try {
      this.publish("loading", message("loadingCache"));
      // Index native text first. Q&A can use all pages while layout is running.
      for (const page of order) { if (this.disposed) return; await this.getNativePage(page); }
      for (const page of order) {
        if (this.disposed) return;
        this.publish("analyzing", message("analyzingLayout", { completed: this.completed.size, total: this.document.pageCount }));
        await this.getPage(page);
      }
      this.publish("ready", message("analysisSaved"));
    } catch (error) {
      if (!this.disposed) this.publish("error", error instanceof Error ? error.message : String(error));
    }
  }

  dispose(): void { this.disposed = true; this.client?.dispose(); this.native.clear(); this.full.clear(); }
}
