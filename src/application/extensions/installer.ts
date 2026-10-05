import { compare } from "semver";
import type { ExtensionPackage } from "../../infrastructure/extensions/package";
import { ExtensionRepository } from "../../infrastructure/extensions/repository";
import { validateManifest, packagePath } from "../../infrastructure/extensions/manifest";
import { sandboxModule } from "../../infrastructure/extensions/sandbox";
import { dependencyProblem, dependentsFirst } from "./dependencies";
import type { ExtensionHost, ExtensionInstallation } from "./host";

export function packageInstallation(pkg: ExtensionPackage): ExtensionInstallation {
  const manifest = validateManifest(pkg.manifest);
  return {
    manifest,
    builtIn: false,
    readResource: async (path) => {
      if (!packagePath(path) || !pkg.files[path])
        throw new Error(`Unavailable package resource: ${path}`);
      return pkg.files[path].slice();
    },
    load: async () => sandboxModule(pkg),
  };
}
export interface InstallationPlan {
  packages: ExtensionPackage[];
  changes: {
    id: string;
    version: string;
    previous?: string;
    downgrade: boolean;
    capabilities: string[];
  }[];
  missing: string[];
  cycles: string[][];
  disabled: string[];
  restart: string[];
  blockedBuiltIns: string[];
}
export class ExtensionInstaller {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private host: ExtensionHost,
    private repository: ExtensionRepository,
  ) {}
  plan(packages: ExtensionPackage[]): InstallationPlan {
    const installed = this.host.getSnapshot().extensions;
    const catalog = new Map(
      installed.map((item) => [item.id, { manifest: item.manifest, enabled: true }]),
    );
    const blockedBuiltIns: string[] = [],
      changes: InstallationPlan["changes"] = [],
      missing = new Set<string>(),
      cycles: string[][] = [];
    const ids = new Set<string>();
    for (const pkg of packages) {
      if (ids.has(pkg.id)) throw new Error(`Duplicate extension package: ${pkg.id}`);
      ids.add(pkg.id);
      const manifest = validateManifest(pkg.manifest),
        previous = installed.find((item) => item.id === pkg.id);
      if (pkg.id !== `${manifest.publisher}.${manifest.name}`)
        throw new Error("Extension package ID mismatch");
      if (previous?.builtIn) blockedBuiltIns.push(pkg.id);
      changes.push({
        id: pkg.id,
        version: manifest.version,
        previous: previous?.manifest.version,
        downgrade: !!previous && compare(manifest.version, previous.manifest.version) < 0,
        capabilities: manifest.capabilities,
      });
      catalog.set(pkg.id, { manifest, enabled: true });
    }
    const affected = dependentsFirst(ids, catalog);
    for (const id of affected) {
      const entry = catalog.get(id)!;
      // Validate all consumers, including those affected by an update's new dependency graph.
      const issue = dependencyProblem(id, catalog);
      if (issue?.kind === "missing") missing.add(issue.path.at(-1)!);
      if (issue?.kind === "cycle" && !cycles.some((path) => path.join() === issue.path.join()))
        cycles.push(issue.path);
      if (ids.has(id))
        for (const member of entry.manifest.extensionPack || [])
          if (!catalog.has(member)) missing.add(member);
    }
    const restart = [
      ...new Set(packages.flatMap((pkg) => [pkg.id, ...this.host.getDependents(pkg.id)])),
    ].filter((id) =>
      installed.some((item) => item.id === id && ["active", "activating"].includes(item.status)),
    );
    const required = new Set<string>(),
      hardDependencies = new Set<string>();
    const collect = (id: string) => {
      if (required.has(id)) return;
      required.add(id);
      const entry = catalog.get(id);
      if (!entry) {
        missing.add(id);
        return;
      }
      for (const dependency of entry.manifest.extensionDependencies || []) {
        hardDependencies.add(dependency);
        collect(dependency);
      }
      if (ids.has(id)) for (const member of entry.manifest.extensionPack || []) collect(member);
    };
    for (const id of ids) collect(id);
    const disabled = installed
      .filter((item) => !item.enabled && hardDependencies.has(item.id))
      .map((item) => item.id);
    return { packages, changes, missing: [...missing], cycles, disabled, restart, blockedBuiltIns };
  }
  async install(plan: InstallationPlan): Promise<void> {
    const operation = this.queue
      .catch(() => undefined)
      .then(async () => {
        const current = this.plan(plan.packages);
        if (current.missing.length || current.cycles.length || current.blockedBuiltIns.length)
          throw new Error("Resolve extension package dependencies before installation");
        const before = await this.repository.list();
        const ids = current.packages.map((pkg) => pkg.id);
        const replacements = before.filter((pkg) => ids.includes(pkg.id));
        const inputs = current.packages.map((pkg) => packageInstallation(pkg));
        await this.repository.change(current.packages);
        try {
          await this.host.installBatch(inputs);
        } catch (error) {
          await this.repository.change(replacements, ids);
          throw error;
        }
      });
    this.queue = operation;
    return operation;
  }
}
