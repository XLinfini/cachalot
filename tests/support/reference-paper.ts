/** Optional real-paper fixture. The analysis cache is local, versioned, and
 * generated on demand; test-results remains output only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LayoutObservations, PageFacts } from "../../src/domain/analysis";
import type { DocumentSemantics, SemanticPageView } from "../../src/domain/document-semantics";
import { projectSemanticPage } from "../../src/application/document-analysis/document-semantics";
import {
  validDocumentSemantics,
  validPageFacts,
  validObservations,
} from "../../src/infrastructure/analysis/validation";
import { DOCUMENT_SEMANTICS_KEY } from "../../src/domain/model";

const run = promisify(execFile);

export async function loadReferencePaper(path: string): Promise<{
  analyses: SemanticPageView[];
  observations: LayoutObservations[];
  bytes: number[];
}> {
  const buffer = await readFile(path);
  const documentId = createHash("sha256").update(buffer).digest("hex");
  const cacheId = createHash("sha256")
    .update(`${documentId}:${DOCUMENT_SEMANTICS_KEY}`)
    .digest("hex");
  const cachePath = join(".test-cache", "reference-paper", `${cacheId}.json`);
  let contents: string;
  try {
    contents = await readFile(cachePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await run(process.execPath, ["--import", "tsx", "scripts/inspect-paper.ts", path], {
      cwd: process.cwd(),
      env: { ...process.env, CACHALOT_ANALYSIS_OUTPUT: cachePath },
      maxBuffer: 1024 * 1024,
      timeout: 300_000,
    });
    contents = await readFile(cachePath, "utf8");
  }
  const bundle = JSON.parse(contents) as {
    facts: PageFacts[];
    observations: LayoutObservations[];
    semantics: DocumentSemantics;
  };
  assert.ok(bundle.facts.length > 0, "Reference paper analysis must contain pages");
  assert.ok(validDocumentSemantics(bundle.semantics, documentId, bundle.facts.length));
  assert.ok(bundle.facts.every((page) => validPageFacts(page, documentId, page.page)));
  assert.ok(bundle.observations.every((page) => validObservations(page, documentId, page.page)));
  return {
    analyses: bundle.facts.map((facts) => projectSemanticPage(bundle.semantics, facts)),
    observations: bundle.observations,
    bytes: Array.from(buffer),
  };
}
