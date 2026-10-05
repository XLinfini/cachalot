import type { ExtensionManifest } from "../../sdk";

export type DependencyProblem = {
  kind: "missing" | "disabled" | "cycle" | "failed";
  path: string[];
};
export interface DependencyEntry {
  manifest: ExtensionManifest;
  enabled: boolean;
}
/** Validate the whole reachable graph before starting any activation promises. */
export function dependencyProblem(
  id: string,
  catalog: ReadonlyMap<string, DependencyEntry>,
): DependencyProblem | undefined {
  const complete = new Set<string>();
  function visit(current: string, path: string[]): DependencyProblem | undefined {
    if (path.includes(current)) return { kind: "cycle", path: [...path, current] };
    const entry = catalog.get(current);
    if (!entry) return { kind: "missing", path: [...path, current] };
    if (!entry.enabled) return { kind: "disabled", path: [...path, current] };
    if (complete.has(current)) return;
    for (const dependency of entry.manifest.extensionDependencies || []) {
      const issue = visit(dependency, [...path, current]);
      if (issue) return issue;
    }
    complete.add(current);
  }
  return visit(id, []);
}
/** Consumers first, providers last, including transitive consumers. */
export function dependentsFirst(
  ids: Iterable<string>,
  catalog: ReadonlyMap<string, DependencyEntry>,
): string[] {
  const result: string[] = [],
    seen = new Set<string>();
  function visit(id: string) {
    if (seen.has(id)) return;
    seen.add(id);
    for (const [consumer, entry] of catalog)
      if (entry.manifest.extensionDependencies?.includes(id)) visit(consumer);
    result.push(id);
  }
  for (const id of ids) visit(id);
  return result;
}
