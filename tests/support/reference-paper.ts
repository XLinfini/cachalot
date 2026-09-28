/** Optional real-paper fixture. The analysis cache is local, versioned, and
 * generated on demand; test-results remains output only. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageAnalysis } from "../../src/domain/analysis";
import { ANALYSIS_CACHE_KEY } from "../../src/domain/model";

const run = promisify(execFile);

export async function loadReferencePaper(path: string): Promise<{
  analyses: PageAnalysis[];
  bytes: number[];
}> {
  const buffer = await readFile(path);
  const documentId = createHash("sha256").update(buffer).digest("hex");
  const cacheId = createHash("sha256").update(`${documentId}:${ANALYSIS_CACHE_KEY}`).digest("hex");
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
  const analyses = JSON.parse(contents) as PageAnalysis[];
  assert.ok(analyses.length > 0, "Reference paper analysis must contain pages");
  assert.ok(
    analyses.every(
      (page) => page.documentId === documentId && page.cacheKey === ANALYSIS_CACHE_KEY,
    ),
    "Reference paper analysis does not match the PDF or current parser version",
  );
  return { analyses, bytes: Array.from(buffer) };
}
